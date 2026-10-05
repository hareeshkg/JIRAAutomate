import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID,randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { registerWorkflows, resolveFlow } from './workflows.js';
import type { Teaching, Workflow } from '../../../packages/contracts/src/workflows.js';
import { Store } from './storage.js';
import { fixture } from '../../../fixtures/jira-ui/index.js';
import { parseKeys,parseCsv,targetSchema,flowVersion,hash,exportCsv,type Plan,type Run } from '../../../packages/contracts/src/index.js';
const port=Number(process.env.PORT||3210);const base=`http://127.0.0.1:${port}`;
const dir=process.env.DATA_DIR||join(process.env.LOCALAPPDATA||homedir(),process.platform==='win32'?'JiraBulk':'.jira-bulk');mkdirSync(dir,{recursive:true,mode:0o700});
const lock=join(dir,'application.lock');
if(existsSync(lock)){const owner=Number(readFileSync(lock,'utf8'));if(!Number.isInteger(owner)||owner<=0)throw new Error('Invalid application lock; inspect manually');try{process.kill(owner,0);throw new Error('This data directory is already owned by a running application');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;unlinkSync(lock);}}
writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
const store=new Store(dir);store.recover();
const app=Fastify({logger:false,bodyLimit:1_000_000});const session=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex'),fixtureSecret=randomBytes(32).toString('hex');
const actionWaiters=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const frameWaiters=new Set<(value:any)=>void>();
let worker:ChildProcess|undefined,busy:{id:string;kind:string}|undefined,frame:any,loginRequired=false;
app.addHook('onRequest',async(req,reply)=>{
 const path=req.url.split('?')[0];if(path.includes('%')||path.includes('\\')||path.includes('//')||path.includes('/../')||path.includes('/./'))return reply.code(400).send({error:'Non-canonical path rejected'});
 if(req.headers.host!==`127.0.0.1:${port}`)return reply.code(403).send({error:'Unexpected Host'});
 if(req.headers.origin&&req.headers.origin!==base)return reply.code(403).send({error:'Unexpected Origin'});
 if(req.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'Cross-site request rejected'});
 reply.header('Cache-Control','no-store');
 if(req.url.startsWith('/api/')&&path!=='/api/bootstrap'){
 if(!req.headers.cookie?.split(';').some(x=>x.trim()===`jira_session=${session}`))return reply.code(401).send({error:'Local session required'});
 if(req.method!=='GET'&&req.headers['x-csrf-token']!==csrf)return reply.code(403).send({error:'CSRF token required'});
 }
});
app.setErrorHandler((error,req,reply)=>{const e=error as Error & {statusCode?:number};reply.code(error instanceof z.ZodError?400:(e.statusCode||400)).send({error:e.message||'Request failed'});});
fixture(app,store,fixtureSecret);
app.get('/api/bootstrap',async(req,reply)=>{reply.header('Set-Cookie',`jira_session=${session}; HttpOnly; SameSite=Strict; Path=/`);return {csrf,mode:'fixture',jiraTarget:'9 Data Center'};});
app.get('/api/status',async()=>({mode:'fixture',jiraTarget:'9 Data Center',activeJob:busy,chrome:'Installed Google Chrome required',flows:['Implement','Done'].map(target=>({id:flowVersion(target as any),target,scope:'DEMO / Epic / fixture only'}))}));
function launch(job:any){
 if(busy)throw Object.assign(new Error('The browser profile is busy'),{statusCode:409});
 busy={id:job.id,kind:job.kind};frame=undefined;loginRequired=false;
 worker=fork(resolve('apps/worker/src/index.ts'),[],{execArgv:['--import','tsx'],env:process.env,stdio:['ignore','inherit','inherit','ipc']});
 worker.on('message',(m:any)=>{
 if(m.type==='teachingUpdate'){const session=store.get<Teaching>('teaching',job.id)!;store.put('teaching',job.id,{...session,...m,id:job.id,type:undefined});}
 else if(m.type==='teachIntent'){const session=store.get<Teaching>('teaching',job.id)!;store.put('teaching',job.id,{...session,intent:m.step});worker?.send({type:'ack',requestId:m.requestId});}
 else if(m.type==='teachActionResult'){const pending=actionWaiters.get(m.requestId);if(pending){clearTimeout(pending.timer);actionWaiters.delete(m.requestId);m.error?pending.reject(new Error(m.error)):pending.resolve({ok:true});}}
 else if(m.type==='checkpoint'){
 const run=store.get<Run>('run',job.id)!;const item=run.items.find(x=>x.key===m.key)!;
 item.state=m.state;item.reason=m.reason;if(!item.startedAt)item.startedAt=new Date().toISOString();if(['succeeded','skipped','blocked','failed','outcome_uncertain'].includes(m.state))item.finishedAt=new Date().toISOString();
 store.event(run,m.reason,m.key);worker?.send({type:'ack',requestId:m.requestId});
 }else if(m.type==='preview'){
 const plan:Plan={id:job.id,hash:'',version:job.flow?.id||flowVersion(job.target),flowId:job.flow?.id,target:job.target,values:job.values,rows:m.rows,rejected:job.rejected,duplicates:job.duplicates,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60_000).toISOString()};plan.hash=hash({...plan,hash:undefined});store.put('plan',plan.id,plan);store.put('job',job.id,{id:job.id,state:'completed',planId:plan.id});
 }else if(m.type==='frame'){frame=m;for(const deliver of frameWaiters)deliver(m);}else if(m.type==='clearFrame'){frame=undefined;}else if(m.type==='loginRequired'){loginRequired=true;}
 else if(m.type==='paused'){const run=store.get<Run>('run',job.id);if(run&&run.state!=='paused'){run.state='paused';store.event(run,'Paused at an item boundary');}}
 else if(m.type==='finished'||m.type==='fatal'){
 finish(job,m.type==='fatal'?m.error:undefined,m.state);worker?.disconnect();worker?.kill();worker=undefined;busy=undefined;frame=undefined;
 }
 });
 worker.on('error',e=>{finish(job,e.message);busy=undefined;frame=undefined;});
 worker.on('exit',()=>{if(busy?.id===job.id){finish(job,'Browser worker exited unexpectedly');busy=undefined;frame=undefined;worker=undefined;}});
 worker.send({...job,type:'job',base,fixtureSecret,profile:join(dir,'profiles','fixture')});
}
function finish(job:any,error?:string,state?:string){
 if(job.kind==='teach'){const session=store.get<Teaching>('teaching',job.id)!;if(error||session.state!=='review')store.put('teaching',job.id,{...session,state:'interrupted',error:error||'Recording interrupted'});for(const [id,pending] of actionWaiters){clearTimeout(pending.timer);pending.reject(new Error('Teaching session closed'));actionWaiters.delete(id);}return;}
 if(job.kind==='preview'){if(error)store.put('job',job.id,{id:job.id,state:'failed',error});return;}
 const run=store.get<Run>('run',job.id)!;
 for(const item of run.items){if(['executing','verifying'].includes(item.state)){item.state='outcome_uncertain';item.reason='Worker lost after mutation intent; reconciliation required';}else if(['pending','rechecking'].includes(item.state)){item.state='not_run';item.reason=error||'Stopped before this issue';}}
 run.state=error?'interrupted':loginRequired?'login_required':state==='stopped'?'stopped':run.items.some(x=>['outcome_uncertain','failed','blocked'].includes(x.state))?'completed_with_issues':'completed';store.event(run,error||`Run ${run.state}`);
 if(run.validationFlowId&&run.items.every(i=>i.state==='succeeded')){const flow=store.get<Workflow>('flow',run.validationFlowId)!;store.put('flow',flow.id,{...flow,state:'validated',validation:{key:run.items[0].key,at:new Date().toISOString(),runId:run.id}});}
}
registerWorkflows(app,store,{busy:()=>busy,launch,action:async(id,body)=>{if(busy?.id!==id||busy.kind!=='teach')throw new Error('No active teaching session');const requestId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{actionWaiters.delete(requestId);reject(new Error('Action timed out; inspect the browser before proceeding'));},15000);actionWaiters.set(requestId,{resolve,reject,timer});worker?.send({type:'teachAction',requestId,...body});});}});
app.post('/api/previews',async(req,reply)=>{
 if(busy)return reply.code(409).send({error:'The browser profile is busy'});
 const body=z.object({input:z.string(),csv:z.boolean().optional(),target:targetSchema.optional(),flowId:z.string().optional(),resolution:z.literal('Done').default('Done')}).parse(req.body);
 const flow=resolveFlow(store,body.flowId,body.target);if(flow.state!=='validated')return reply.code(422).send({error:'Validate the draft workflow on another Epic before bulk preview'});
 const parsed=parseKeys(body.csv?parseCsv(body.input):body.input);const id=randomUUID();store.put('job',id,{id,state:'running'});
 launch({id,kind:'preview',...parsed,flow,target:flow.target,values:{resolution:body.resolution}});return reply.code(202).send({id});
});
app.get('/api/jobs/:id',async(req,reply)=>store.get('job',(req.params as any).id)||reply.code(404).send({error:'Job not found'}));
app.get('/api/plans/:id',async(req,reply)=>store.plan((req.params as any).id)||reply.code(404).send({error:'Plan not found'}));
app.post('/api/runs',async(req,reply)=>{
 const body=z.object({planId:z.string().uuid(),planHash:z.string(),selected:z.array(z.string()).min(1).max(100),idempotencyKey:z.string().uuid(),confirmed:z.literal(true)}).parse(req.body);
 const fingerprint=hash({...body,idempotencyKey:undefined});const prior=store.db.prepare('SELECT run_id,request_hash FROM idempotency WHERE key=?').get(body.idempotencyKey) as any;
 if(prior)return prior.request_hash===fingerprint?{id:prior.run_id}:reply.code(409).send({error:'Idempotency key reused for a different request'});
 if(busy)return reply.code(409).send({error:'The browser profile is busy'});
 const plan=store.plan(body.planId);if(!plan||plan.hash!==body.planHash||Date.parse(plan.expiresAt)<Date.now())return reply.code(409).send({error:'Missing, changed or expired plan; preview again'});
 if(new Set(body.selected).size!==body.selected.length||body.selected.some(key=>!plan.rows.some(r=>r.key===key&&r.eligibility==='eligible')))return reply.code(400).send({error:'Select only unique eligible rows from this plan'});
 const unresolved=store.list<Run>('run').flatMap(r=>r.items.filter(i=>i.state==='outcome_uncertain').map(i=>i.key));
 if(body.selected.some(key=>unresolved.includes(key)))return reply.code(409).send({error:'Selected issues have unresolved outcomes; reconcile their previous runs first'});
 const id=randomUUID();const run:Run={id,planId:plan.id,version:plan.version,flowId:plan.flowId,state:'running',target:plan.target,createdAt:new Date().toISOString(),events:[],items:plan.rows.map(row=>({...row,state:body.selected.includes(row.key)?'pending':row.eligibility==='blocked'?'blocked':'skipped',reason:body.selected.includes(row.key)?'Queued':row.eligibility==='eligible'?'Not selected':row.reason}))};
 store.db.exec('BEGIN IMMEDIATE');try{store.put('run',id,run);store.db.prepare('INSERT INTO idempotency VALUES(?,?,?)').run(body.idempotencyKey,id,fingerprint);store.event(run,`Confirmed ${body.selected.length} issues · ${plan.version}`);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
 launch({id,kind:'run',flow:resolveFlow(store,plan.flowId,plan.target),rows:plan.rows.filter(r=>body.selected.includes(r.key)),target:plan.target,values:plan.values});return reply.code(202).send({id});
});
app.post('/api/runs/:id/reconcile',async(req,reply)=>{
 if(busy)return reply.code(409).send({error:'The browser profile is busy'});
 const run=store.get<Run>('run',(req.params as any).id);if(!run)return reply.code(404).send({error:'Run not found'});
 const rows=run.items.filter(i=>i.state==='outcome_uncertain');if(!rows.length)return reply.code(409).send({error:'No uncertain items to reconcile'});
 run.state='running';store.event(run,'Read-only reconciliation requested');launch({id:run.id,kind:'reconcile',flow:resolveFlow(store,run.flowId,run.target),rows,target:run.target,values:{resolution:'Done'}});return reply.code(202).send({id:run.id});
});
app.get('/api/runs',async()=>store.list<Run>('run'));
app.get('/api/runs/:id',async(req,reply)=>store.get<Run>('run',(req.params as any).id)||reply.code(404).send({error:'Run not found'}));
app.post('/api/jobs/:id/:action',async(req,reply)=>{
 const {id,action}=req.params as any;if(busy?.id!==id||busy?.kind!=='run')return reply.code(409).send({error:'No active execution job'});
 if(!['pause','resume','stop'].includes(action))return reply.code(400).send({error:'Unsupported control'});
 const run=store.get<Run>('run',id)!;if(run.state==='stop_requested')return reply.code(409).send({error:'Stop is already requested'});
 run.state=action==='pause'?'pause_requested':action==='stop'?'stop_requested':'running';store.event(run,`${action} requested; takes effect between items`);worker?.send({type:'control',action:action==='resume'?'running':action});return {state:run.state};
});
app.get('/api/jobs/:id/preview/frame',async(req,reply)=>{
 if(busy?.id!==(req.params as any).id)return reply.code(204).send();
 const latest:any=await new Promise(resolve=>{const deliver=(value:any)=>{if(value.jobId===(req.params as any).id){clearTimeout(timer);frameWaiters.delete(deliver);resolve(value);}};const timer=setTimeout(()=>{frameWaiters.delete(deliver);resolve(undefined);},1000);frameWaiters.add(deliver);worker?.send({type:'frame'});});
 if(!latest||busy?.id!==latest.jobId)return reply.code(204).send();
 reply.header('X-Frame-Metadata',JSON.stringify({key:latest.key,step:latest.step,at:latest.at,sequence:latest.sequence,jobId:latest.jobId}));return reply.type('image/jpeg').send(Buffer.from(latest.image,'base64'));
});
app.get('/api/runs/:id/export',async(req,reply)=>{const run=store.get<Run>('run',(req.params as any).id);if(!run)return reply.code(404).send({error:'Run not found'});const csv=(req.query as any).format==='csv';reply.header('Content-Disposition',`attachment; filename="run-${run.id}.${csv?'csv':'json'}"`);return csv?reply.type('text/csv').send(exportCsv(run)):run;});
const built=resolve('dist/web');if(existsSync(built)&&!process.argv.includes('--dev')){await app.register(staticPlugin,{root:built});app.get('/',(req,reply)=>reply.sendFile('index.html'));}else{
 const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
 app.setNotFoundHandler((req,reply)=>{if(req.url.startsWith('/api/')||req.url.startsWith('/fixture/'))return reply.code(404).send({error:'Not found'});reply.hijack();vite.middlewares(req.raw,reply.raw,()=>{reply.raw.statusCode=404;reply.raw.end('Not found');});});app.addHook('onClose',async()=>vite.close());
}
async function shutdown(){worker?.kill();await app.close();store.db.close();if(existsSync(lock))unlinkSync(lock);process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
await app.listen({host:'127.0.0.1',port});console.log(`Jira Bulk fixture workspace: ${base} (data: ${dir})`);
