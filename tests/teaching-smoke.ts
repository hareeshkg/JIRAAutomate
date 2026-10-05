import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const data=mkdtempSync(join(tmpdir(),'jira-teaching-smoke-')),port=3297,base=`http://127.0.0.1:${port}`;
let server:ChildProcess,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,cookie='',csrf='';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until<T>(fn:()=>Promise<T|undefined>,limit=30000):Promise<T>{const end=Date.now()+limit;while(Date.now()<end){const result=await fn();if(result)return result;await sleep(150)}throw new Error('Timed out waiting for teaching condition');}
async function api(path:string,body?:unknown){const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(`${response.status}: ${value.error}`);return value;}
async function idle(){await until(async()=>!(await api('/status')).activeJob);}
async function terminal(id:string){const run=await until(async()=>{const r=await api('/runs/'+id);return !['running','paused','pause_requested','stop_requested'].includes(r.state)?r:undefined});await idle();return run;}
async function frame(id:string){return until(async()=>{const r=await fetch(`${base}/api/jobs/${id}/preview/frame`,{headers:{Cookie:cookie}});if(r.status!==200)return;const metadata=JSON.parse(r.headers.get('X-Frame-Metadata')!);const bytes=Buffer.from(await r.arrayBuffer());return {metadata,bytes};});}
try{
 server=spawn(process.execPath,['--import','tsx','apps/server/src/index.ts'],{env:{...process.env,DATA_DIR:data,PORT:String(port),JIRA_BULK_HEADLESS:'1'},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});server.stderr?.on('data',x=>process.stderr.write(x));
 await until(async()=>{try{const response=await fetch(base+'/api/bootstrap');if(!response.ok)return;cookie=response.headers.get('set-cookie')!.split(';')[0];csrf=(await response.json()).csrf;return true}catch{}});
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(base);await page.getByText('Local session ready',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Status transitions',exact:true}).click();
 await page.getByLabel('Workflow name',{exact:true}).fill('Design review');await page.getByLabel('Source status',{exact:true}).fill('Ready');await page.getByLabel('Transition label in Jira').fill('Send for review');await page.getByLabel('Destination status').fill('In Review');await page.getByRole('button',{name:'Save transition draft'}).click();
 const configured=await until(async()=>{const f=(await api('/flows')).find((f:any)=>f.name==='Design review');return f?.state==='draft'?f:undefined;});
 await assert.rejects(()=>api('/previews',{input:'DEMO-12',flowId:configured.id}),/422/);
 await page.getByRole('button',{name:'Teach Workflow',exact:true}).click();await page.getByLabel('Sample Epic',{exact:true}).fill('DEMO-11');await page.getByLabel('Workflow to demonstrate').selectOption(configured.id);await page.getByRole('checkbox',{name:'I understand teaching changes'}).check();await page.getByRole('button',{name:'Start teaching',exact:true}).click();
 const session=await until(async()=>{const status=await api('/status');if(status.activeJob?.kind==='teach'){const t=await api('/teach/'+status.activeJob.id);if(t.state==='recording')return t;}});
 const first=await frame(session.id);writeFileSync(join(data,'initial-viewport.jpg'),first.bytes);console.log('Teaching fixture viewport: '+join(data,'initial-viewport.jpg'));
 // All clicks go through the displayed application image and its server-side recording path.
 async function clickImage(x:number,y:number){await page.getByAltText('Interactive teaching browser').waitFor();const image=page.getByAltText('Interactive teaching browser');const box=(await image.boundingBox())!;await image.click({position:{x:x*box.width/1280,y:y*box.height/800}});}
 await clickImage(100,235);await until(async()=>{const t=await api('/teach/'+session.id);return t.steps.length===1?t:undefined;});await sleep(800);
 const menu=await frame(session.id);writeFileSync(join(data,'menu-viewport.jpg'),menu.bytes);
 await clickImage(110,352);await until(async()=>{const t=await api('/teach/'+session.id);return t.steps.length===2?t:undefined;});
 await page.getByRole('button',{name:'Finish and verify recording'}).click();await until(async()=>(await api('/teach/'+session.id)).state==='review'?true:undefined);await idle();
 await page.getByLabel('Workflow name',{exact:true}).fill('Recorded design review');const editor=page.getByLabel('Playwright script',{exact:true});await editor.waitFor();assert((await editor.inputValue()).includes('Send for review'));await editor.fill((await editor.inputValue()).replace('Recorded Epic transition','Reviewed Epic transition'));
 await page.getByRole('checkbox',{name:'I reviewed the actions'}).check();await page.getByRole('button',{name:'Save workflow draft',exact:true}).click();
 const recorded=await until(async()=>{const flow=(await api('/flows')).find((f:any)=>f.name==='Recorded design review');return flow?.state==='draft'?flow:undefined;});assert.equal(recorded.steps.length,2);
 await assert.rejects(()=>api(`/flows/${recorded.id}/validate`,{key:'DEMO-11',confirmed:true}),/different/);
 await assert.rejects(()=>api(`/flows/${recorded.id}/revise`,{name:'Unsafe',script:recorded.script.replace('await page.reload();','await page.evaluate(() => document.body.remove());'),reviewed:true}),/Unsupported/);
 const validation=await api(`/flows/${recorded.id}/validate`,{key:'DEMO-12',confirmed:true});const result=await terminal(validation.id);assert.equal(result.items[0].state,'succeeded');assert.equal((await api('/flows')).find((f:any)=>f.id===recorded.id).state,'validated');
 const preview=await api('/previews',{input:'DEMO-13',flowId:recorded.id});await until(async()=>(await api('/jobs/'+preview.id)).state==='completed'?true:undefined);await idle();const plan=await api('/plans/'+preview.id);assert.equal(plan.target,'In Review');assert.equal(plan.rows[0].eligibility,'eligible');assert.equal(plan.version,recorded.id);
 const run=await api('/runs',{planId:plan.id,planHash:plan.hash,selected:['DEMO-13'],idempotencyKey:crypto.randomUUID(),confirmed:true});const bulk=await terminal(run.id);assert.equal(bulk.items[0].state,'succeeded');
 const revised=await api(`/flows/${recorded.id}/revise`,{name:recorded.name,script:recorded.script,reviewed:true});assert.equal(revised.version,2);assert.equal(revised.state,'draft');assert.equal((await api('/flows')).find((f:any)=>f.id===recorded.id).state,'validated');
 const approval=await api('/flows',{definition:{name:'Approval dialog',source:'Ready',target:'Approved',label:'Approve review',mode:'resolution'}});
 await page.getByRole('button',{name:'Status transitions',exact:true}).click();await page.getByRole('button',{name:'Teach Workflow',exact:true}).click();
 await page.getByLabel('Sample Epic',{exact:true}).fill('DEMO-14');await page.getByLabel('Workflow to demonstrate').selectOption(approval.id);await page.getByRole('button',{name:'Start teaching',exact:true}).click();
 const dialogSession=await until(async()=>{const status=await api('/status');if(status.activeJob?.kind==='teach'){const t=await api('/teach/'+status.activeJob.id);if(t.state==='recording')return t;}});
 await frame(dialogSession.id);await sleep(700);await clickImage(100,235);await until(async()=>(await api('/teach/'+dialogSession.id)).steps.length===1?true:undefined);await sleep(700);
 await clickImage(110,352);await until(async()=>(await api('/teach/'+dialogSession.id)).steps.length===2?true:undefined);await sleep(700);
 const dialogFrame=await frame(dialogSession.id);writeFileSync(join(data,'dialog-viewport.jpg'),dialogFrame.bytes);console.log('Dialog viewport: '+join(data,'dialog-viewport.jpg'));
 await clickImage(640,385);await page.getByLabel('Selected field: #resolution').waitFor();await page.getByLabel('Selected field: #resolution').selectOption('Done');await page.getByRole('button',{name:'Apply and record value'}).click();await until(async()=>(await api('/teach/'+dialogSession.id)).steps.length===3?true:undefined);await sleep(700);
 await clickImage(520,458);await until(async()=>(await api('/teach/'+dialogSession.id)).steps.length===4?true:undefined);await page.getByRole('button',{name:'Finish and verify recording'}).click();await until(async()=>(await api('/teach/'+dialogSession.id)).state==='review'?true:undefined);await idle();
 await page.getByLabel('Workflow name',{exact:true}).fill('Recorded approval');await page.getByRole('checkbox',{name:'I reviewed the actions'}).check();await page.getByRole('button',{name:'Save workflow draft',exact:true}).click();
 const dialogFlow=await until(async()=>{const f=(await api('/flows')).find((f:any)=>f.name==='Recorded approval');return f||undefined;});assert.equal(dialogFlow.steps[2].value,'Done');
 const dialogValidation=await api(`/flows/${dialogFlow.id}/validate`,{key:'DEMO-15',confirmed:true});assert.equal((await terminal(dialogValidation.id)).items[0].state,'succeeded');
 await page.getByRole('button',{name:'Status transitions',exact:true}).click();await page.screenshot({path:join(data,'status-transitions.png'),fullPage:true});assert.deepEqual(errors,[]);
 assert.equal((await api('/flows')).filter((f:any)=>f.kind==='builtin').length,2);
 console.log('PASS: custom transitions, embedded teaching clicks, edited AST script, immutable save, second-Epic validation, custom bulk replay, and preserved built-ins. Artifacts: '+data);
}finally{await browser?.close();if(server!?.pid){if(process.platform!=='win32')process.kill(-server.pid!,'SIGTERM');else server.kill('SIGTERM');}}
