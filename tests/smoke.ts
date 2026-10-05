import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
const data=mkdtempSync(join(tmpdir(),'jira-bulk-smoke-')),port=3298,base=`http://127.0.0.1:${port}`;
let server:ChildProcess,cookie='',csrf='';let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until<T>(fn:()=>Promise<T|undefined>,limit=60000):Promise<T>{const end=Date.now()+limit;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(100)}throw new Error('Timed out waiting for condition');}
async function request(path:string,body?:unknown){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(`${r.status}: ${value.error}`);return value;}
async function start(){server=spawn(process.execPath,['--import','tsx','apps/server/src/index.ts'],{env:{...process.env,DATA_DIR:data,PORT:String(port),JIRA_BULK_HEADLESS:'1'},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});server.stderr?.on('data',x=>process.stderr.write(x));await until(async()=>{try{const r=await fetch(base+'/api/bootstrap');if(!r.ok)return;cookie=r.headers.get('set-cookie')!.split(';')[0];csrf=(await r.json()).csrf;return true}catch{}},20000);}
function stop(signal:NodeJS.Signals='SIGTERM'){if(server?.pid){if(process.platform!=='win32')process.kill(-server.pid,signal);else server.kill(signal);}}
async function preview(keys:string,target='Implement'){const j=await request('/previews',{input:keys,target});await until(async()=>{const status=await request('/jobs/'+j.id);if(status.state==='failed')throw new Error(status.error);if(status.state==='completed')return true;});await until(async()=>!(await request('/status')).activeJob);return request('/plans/'+j.id);}
async function execute(plan:any,selected?:string[]){const body={planId:plan.id,planHash:plan.hash,selected:selected||plan.rows.filter((r:any)=>r.eligibility==='eligible').map((r:any)=>r.key),idempotencyKey:crypto.randomUUID(),confirmed:true};const j=await request('/runs',body);assert.equal((await request('/runs',body)).id,j.id,'duplicate Execute must return the same run');return j.id;}
async function done(id:string){const r=await until(async()=>{const r=await request('/runs/'+id);return !['running','paused','pause_requested','stop_requested'].includes(r.state)?r:undefined;});await until(async()=>!(await request('/status')).activeJob);return r;}
const db=()=>new DatabaseSync(join(data,'jira-bulk.sqlite'),{readOnly:true});
function mutations(){const d=db();try{return Number((d.prepare('SELECT COUNT(*) AS n FROM mutations').get() as any).n)}finally{d.close()}}
try{
 await start();
 assert.equal((await fetch(base+'/api/status')).status,401);
 assert.equal((await fetch(base+'/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(base+'/api/previews',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({input:'DEMO-1',target:'Implement'})})).status,403);
 assert.equal((await fetch(base+'/api/jobs/no-id/preview/frame')).status,401);
 const p=await preview('DEMO-1 DEMO-2 DEMO-3 DEMO-4 DEMO-5 DEMO-6 DEMO-7 DEMO-8 DEMO-9 DEMO-10 DEMO-1 bad');
 assert.equal(mutations(),0,'preview must perform zero mutations');assert.deepEqual(p.duplicates,['DEMO-1']);assert.deepEqual(p.rejected,['bad']);assert.equal(p.rows.find((r:any)=>r.key==='DEMO-5').eligibility,'blocked');assert.equal(p.rows.find((r:any)=>r.key==='DEMO-7').eligibility,'blocked');
 await assert.rejects(()=>request('/runs',{planId:p.id,planHash:'wrong',selected:['DEMO-1'],idempotencyKey:crypto.randomUUID(),confirmed:true}),/409/);
 const id=await execute(p);const r=await done(id);assert.equal(r.items.filter((i:any)=>i.state==='succeeded').length,4);assert.equal(mutations(),4,'each selected issue submits once, including delayed response');
 const d=await preview('DEMO-1 DEMO-2 DEMO-3 DEMO-8','Done');const did=await execute(d);const dr=await done(did);assert.equal(dr.items.filter((i:any)=>i.state==='succeeded').length,3);assert.equal(dr.items.find((i:any)=>i.key==='DEMO-8').state,'outcome_uncertain');assert.equal(mutations(),7);
 await request('/runs/'+did+'/reconcile',{});const rec=await done(did);assert.equal(rec.items.find((i:any)=>i.key==='DEMO-8').state,'outcome_uncertain');assert.equal(mutations(),7,'reconciliation is read only');
 const fifty=await preview(Array.from({length:50},(_,i)=>`DEMO-${i+11}`).join('\n'));assert.equal(fifty.rows.length,50);assert.equal(mutations(),7);
 const fid=await execute(fifty);
 const captured=await until(async()=>{const response=await fetch(`${base}/api/jobs/${fid}/preview/frame`,{headers:{Cookie:cookie}});if(response.status!==200)return;const metadata=JSON.parse(response.headers.get('X-Frame-Metadata')!);assert.equal(metadata.jobId,fid);assert.match(metadata.key,/^DEMO-/);assert((await response.arrayBuffer()).byteLength>1000);return true;},15000);assert(captured);
 await until(async()=>{const rr=await request('/runs/'+fid);return rr.items.some((i:any)=>i.state==='succeeded')?true:undefined;});
 await request('/jobs/'+fid+'/pause',{});await until(async()=>(await request('/runs/'+fid)).state==='paused'?true:undefined);const pausedCount=mutations();await sleep(700);assert.equal(mutations(),pausedCount,'paused worker cannot mutate next item');await request('/jobs/'+fid+'/resume',{});
 const fr=await done(fid);assert.equal(fr.items.filter((i:any)=>i.state==='succeeded').length,50);assert.equal(mutations(),57);
 // Capture the actual application and confirm it has no browser errors.
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByText('Local session ready',{exact:true}).waitFor();await page.screenshot({path:join(data,'workspace.png'),fullPage:true});assert.deepEqual(errors,[]);await browser.close();browser=undefined;
 // Crash after durable intent, while completion is in flight. Restart must never replay it.
 const crashPlan=await preview('DEMO-9','Done');const crashId=await execute(crashPlan);
 await until(async()=>{const d=db();try{return d.prepare('SELECT 1 FROM mutations WHERE key=? AND target=?').get('DEMO-9','Done')?true:undefined;}finally{d.close()}});
 stop('SIGKILL');await sleep(500);await start();const recovered=await request('/runs/'+crashId);assert.equal(recovered.state,'interrupted');assert.equal(recovered.items[0].state,'outcome_uncertain');const crashCount=mutations();await sleep(700);assert.equal(mutations(),crashCount,'restart cannot replay mutations');
 await request('/runs/'+crashId+'/reconcile',{});const reconciled=await done(crashId);assert.equal(reconciled.items[0].state,'succeeded');assert.equal(mutations(),crashCount);
 const stopPlan=await preview('DEMO-11 DEMO-12 DEMO-13','Done');const stopId=await execute(stopPlan);await request('/jobs/'+stopId+'/stop',{});const stopped=await done(stopId);assert.equal(stopped.state,'stopped');assert(stopped.items.some((i:any)=>i.state==='not_run'));
 const exportResponse=await fetch(`${base}/api/runs/${id}/export?format=csv`,{headers:{Cookie:cookie}});assert.equal((await exportResponse.text()).split('\r\n').length,11);
 console.log(`PASS: preview, security, idempotency, direct/modal transitions, delayed response, 50-item batch, pause/resume/stop, crash recovery, reconciliation, exports and UI. Artifacts: ${data}`);
}finally{await browser?.close();stop();}
