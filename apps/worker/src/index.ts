import { chromium, type Page, type Locator } from 'playwright';
import type { Observation, Target } from '../../../packages/contracts/src/index.js';
import { builtins, type Workflow, type RecordedLocator, type RecordedStep } from '../../../packages/contracts/src/workflows.js';
import { generateScript } from '../../../packages/contracts/src/script.js';
import { mkdirSync } from 'node:fs';
let control='running', activePage:Page|undefined, frameBusy=false, frameEnabled=false, activeKey='', activeStep='', jobId='';
let epoch=0;let teaching:any;let teachingDone:(()=>void)|undefined;let actionBusy=false;
const deliveredFrames=new Map<number,{epoch:number;at:number}>();
function locate(page:Page,l:RecordedLocator):Locator {return l.kind==='css'?page.locator(l.value):l.kind==='label'?page.getByLabel(l.value,{exact:true}):page.getByRole(l.role!,{name:l.value,exact:true});}
async function perform(page:Page,step:RecordedStep){const l=locate(page,step.locator);if(await l.count()!==1||!await l.isVisible())throw new Error('Locator must match exactly one visible control');if(step.action==='click')await l.click();else if(step.action==='fill')await l.fill(step.value!);else await l.selectOption({label:step.value!});}
async function teachIntent(step:RecordedStep){const requestId=++sequence;await new Promise<void>(resolve=>{acknowledgements.set(requestId,resolve);send({type:'teachIntent',requestId,step});});}

process.on('disconnect',()=>{control='stop';frameEnabled=false;process.exit(0);});
let sequence=0;const acknowledgements=new Map<number,()=>void>();
function send(value:unknown){process.send?.(value);}
async function checkpoint(key:string,state:string,reason:string){const requestId=++sequence;await new Promise<void>(resolve=>{acknowledgements.set(requestId,resolve);send({type:'checkpoint',requestId,key,state,reason});});}
process.on('message',async(message:any)=>{
 if(message.type==='ack'){acknowledgements.get(message.requestId)?.();acknowledgements.delete(message.requestId);return;}
 if(message.type==='teachAction'){await teachAction(message);return;}
 if(message.type==='control'){control=message.action;return;}
 if(message.type==='frame'){if(!frameEnabled||!activePage||frameBusy)return;frameBusy=true;const generation=epoch;const metadata={jobId,key:activeKey,step:activeStep,at:new Date().toISOString()};try{const bytes=await activePage.screenshot({type:'jpeg',quality:65,timeout:1000});if(frameEnabled&&generation===epoch){const frameSequence=++sequence;deliveredFrames.set(frameSequence,{epoch,at:Date.now()});if(deliveredFrames.size>8)deliveredFrames.delete(deliveredFrames.keys().next().value!);send({type:'frame',...metadata,sequence:frameSequence,image:bytes.toString('base64')});}}catch{}finally{frameBusy=false;}return;}
 if(message.type!=='job')return;
 control='running';jobId=message.id;
 try{await work(message);send({type:'finished',state:control==='stop'?'stopped':'completed'});}catch(e){send({type:'fatal',error:e instanceof Error?e.message:'Browser worker failed'});}
});
async function uniqueText(page:Page,testid:string){const l=page.getByTestId(testid);if(await l.count()!==1||!await l.isVisible())throw new Error(`Missing or ambiguous ${testid}`);return (await l.innerText()).trim();}
async function inspect(page:Page,key:string,target:Target,base:string,flow:Workflow,discovery=true):Promise<Observation>{
 frameEnabled=false;epoch++;activeKey=key;activeStep='Open and identify Epic';send({type:'clearFrame'});
 const response=await page.goto(`${base}/fixture/browse/${encodeURIComponent(key)}`,{waitUntil:'domcontentloaded',timeout:10000});
 if(page.url()!==`${base}/fixture/browse/${encodeURIComponent(key)}`)throw new Error('Unexpected navigation');
 if(await page.getByTestId('login-required').count())throw new Error('LOGIN_REQUIRED');
 if(response?.status()!==200)throw new Error('Issue not found');
 if(await uniqueText(page,'issue-key')!==key)throw new Error('Issue identity mismatch');
 const type=await uniqueText(page,'issue-type'),from=await uniqueText(page,'issue-status'),summary=await uniqueText(page,'issue-summary');
 frameEnabled=true;activeStep='Read status and verify scope';
 const row:Observation={key,summary,type,from,target,eligibility:'eligible',reason:'Visible transition available; server validators checked during execution'};
 if(type!=='Epic')return {...row,eligibility:'blocked',reason:'Only Epics are supported'};
 if(!key.startsWith('DEMO-'))return {...row,eligibility:'blocked',reason:'Outside validated fixture project'};
 if(from===target)return {...row,eligibility:'skipped',reason:'Already at target'};
 if(from!==flow.source)return {...row,eligibility:'blocked',reason:'Source status outside validated workflow variant'};
 if(!discovery)return row;
 const button=page.locator('#status-menu');if(await button.count()!==1)throw new Error('Ambiguous status control');await button.click();
 const entry=page.getByRole('menuitem',{name:flow.label,exact:true});
 if(await entry.count()!==1||!await entry.isVisible())return {...row,eligibility:'blocked',reason:'Direct transition unavailable or permission denied'};
 return row;
}
async function work(job:any){
 mkdirSync(job.profile,{recursive:true,mode:0o700});
 const context=await chromium.launchPersistentContext(job.profile,{channel:'chrome',headless:process.env.JIRA_BULK_HEADLESS==='1',viewport:{width:1280,height:800},extraHTTPHeaders:{'x-fixture-token':job.fixtureSecret}});
 const page=context.pages()[0]||await context.newPage();activePage=page;page.setDefaultTimeout(3000);const flow:Workflow=job.flow||builtins.find(f=>f.target===job.target)!;
 try{
 if(job.kind==='teach'){
 const row=await inspect(page,job.sampleKey,flow.target,job.base,flow,false);if(row.eligibility!=='eligible')throw new Error(row.reason);
 teaching={...job,steps:[]};activeStep='Interactive teaching';send({type:'teachingUpdate',state:'recording',steps:[],script:generateScript(job.sampleKey,flow.target,[]),status:row.from});await new Promise<void>(resolve=>{teachingDone=resolve});teaching=undefined;return;
 }
 if(job.kind==='reconcile'){
 for(const original of job.rows as Observation[]){try{const row=await inspect(page,original.key,job.target,job.base,flow);await checkpoint(original.key,row.type==='Epic'&&row.from===job.target?'succeeded':'outcome_uncertain',row.type==='Epic'&&row.from===job.target?'Target confirmed by read-only reconciliation':'Target not proven; manual review required');}catch(e){await checkpoint(original.key,'outcome_uncertain',e instanceof Error?e.message:'Reconciliation failed');}}return;
 }
 if(job.kind==='preview'){
 const rows:Observation[]=[];
 for(const key of job.keys){try{rows.push(await inspect(page,key,job.target,job.base,flow));}catch(e){const reason=e instanceof Error?e.message:'Read failed';rows.push({key,summary:'Unavailable',type:'Unknown',from:'Unknown',target:job.target,eligibility:'blocked',reason:reason==='LOGIN_REQUIRED'?'Login required':reason});}}
 send({type:'preview',rows});return;
 }
 for(const original of job.rows as Observation[]){
 while(control==='pause'){send({type:'paused'});await new Promise(resolve=>setTimeout(resolve,250));}
 if(control==='stop')break;
 let mutation=false;
 try{
 await checkpoint(original.key,'rechecking','Rechecking identity, type, source status and transition');
 const row=await inspect(page,original.key,job.target,job.base,flow);
 if(row.eligibility!=='eligible'){await checkpoint(row.key,row.eligibility,row.reason);continue;}
 if(row.from!==original.from){await checkpoint(row.key,'blocked','Source changed since preview');continue;}
 if(flow.steps){
 // Discovery left the menu open; recorded replay starts from the original closed-menu page.
 if(await page.locator('#menu').isVisible())await page.locator('#status-menu').click();
 for(const step of flow.steps){activeStep=step.action+' '+step.locator.value;if(step.effect==='mayMutate'){await checkpoint(row.key,'executing','Recorded mutation intent committed before '+step.locator.value);mutation=true;}await perform(page,step);}
 }else{
 activeStep='Select transition';await checkpoint(row.key,'executing','Mutation intent committed before transition selection');mutation=true;
 await page.getByRole('menuitem',{name:flow.label,exact:true}).click();
 if(flow.mode==='resolution'){
 await page.getByRole('dialog').waitFor({state:'visible'});activeStep='Complete transition fields';
 const fields=page.getByRole('dialog').locator('input[required],select[required],textarea[required]');
 if(await fields.count()!==1||await page.locator('#resolution').count()!==1){await checkpoint(row.key,'outcome_uncertain','Unknown required fields after mutation boundary; inspect Jira');continue;}
 await page.getByLabel('Resolution',{exact:false}).selectOption({label:job.values.resolution});
 activeStep='Submit transition';await checkpoint(row.key,'executing','Mutation intent committed before dialog submission');
 await page.getByRole('button',{name:'Complete',exact:true}).click();
 }
 }
 activeStep='Reload and verify persisted status';await checkpoint(row.key,'verifying','Waiting for completion; then reload verification');
 try{await page.getByTestId('issue-status').filter({hasText:new RegExp('^'+job.target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')}).waitFor({state:'visible',timeout:3000});}catch{}
 frameEnabled=false;epoch++;send({type:'clearFrame'});await page.reload({waitUntil:'domcontentloaded'});
 if(await page.getByTestId('login-required').count())throw new Error('LOGIN_REQUIRED');
 if(await uniqueText(page,'issue-key')!==row.key)throw new Error('Issue identity changed during verification');
 const status=await uniqueText(page,'issue-status');frameEnabled=true;
 await checkpoint(row.key,status===job.target?'succeeded':'outcome_uncertain',status===job.target?'Exact target status verified after reload':'Target not proven after submission; inspect Jira before another action');
 }catch(e){const reason=e instanceof Error?e.message:'Execution failed';frameEnabled=false;send({type:'clearFrame'});await checkpoint(original.key,mutation?'outcome_uncertain':reason==='LOGIN_REQUIRED'?'blocked':'failed',reason==='LOGIN_REQUIRED'?'Login required — continue in Chrome':reason);if(reason==='LOGIN_REQUIRED'){control='stop';send({type:'loginRequired'});break;}}
 }
 }finally{teaching=undefined;teachingDone=undefined;frameEnabled=false;activePage=undefined;send({type:'clearFrame'});await context.close();}
}

async function teachAction(message:any){
 const requestId=message.requestId;
 if(!teaching||!activePage||actionBusy){send({type:'teachActionResult',requestId,error:'Teaching is not ready or an action is still running'});return;}
 actionBusy=true;const page=activePage;
 try{
 if(message.action==='finish'){
 frameEnabled=false;epoch++;send({type:'clearFrame'});await page.reload({waitUntil:'domcontentloaded'});
 if(await uniqueText(page,'issue-key')!==teaching.sampleKey)throw new Error('Issue identity changed');
 const status=await uniqueText(page,'issue-status');send({type:'teachingUpdate',state:'review',steps:teaching.steps,script:generateScript(teaching.sampleKey,teaching.flow.target,teaching.steps),status});
 send({type:'teachActionResult',requestId});teachingDone?.();return;
 }
 const frame=deliveredFrames.get(message.frameSequence);if(!frame||frame.epoch!==epoch||Date.now()-frame.at>3000)throw new Error('Preview frame is stale; wait for a fresh frame');
 if(await uniqueText(page,'issue-key')!==teaching.sampleKey)throw new Error('Issue identity changed');
 let step:RecordedStep|undefined;
 if(message.action==='click'){
 const evidence=await page.evaluate(({x,y})=>{
 const el=document.elementFromPoint(x,y)?.closest('button,input,select,textarea') as HTMLElement|null;
 if(!el)return null;
 const label=el.closest('label')?.childNodes[0]?.textContent?.trim();
 const locator=el.id?{kind:'css',value:'#'+el.id}:el.getAttribute('role')==='menuitem'?{kind:'role',role:'menuitem',value:el.textContent?.trim()}:null;
 if(!locator)return null;
 const tag=el.tagName.toLowerCase();return {locator,kind:tag,options:tag==='select'?Array.from((el as HTMLSelectElement).options).map(o=>o.label).filter(Boolean):undefined,label};
 },{x:message.x,y:message.y});
 if(!evidence)throw new Error('Choose a supported browser control');
 const l=evidence.locator as RecordedLocator;
 if(evidence.kind==='input'||evidence.kind==='textarea'||evidence.kind==='select'){
 teaching.selectedControl={locator:l,kind:evidence.kind==='select'?'select':'input',options:evidence.options};send({type:'teachingUpdate',selectedControl:teaching.selectedControl});send({type:'teachActionResult',requestId});return;
 }
 step={action:'click',locator:l,effect:l.kind==='css'&&l.value==='#status-menu'?'read':'mayMutate'};
 }else if(message.action==='value'){
 if(!teaching.selectedControl)throw new Error('Select a field in the browser preview first');
 step={action:teaching.selectedControl.kind==='select'?'selectOption':'fill',locator:teaching.selectedControl.locator,value:message.value,effect:'read'};
 }else throw new Error('Unsupported teaching action');
 if(teaching.steps.length>=100)throw new Error('Maximum 100 recorded actions');
 frameEnabled=false;epoch++;send({type:'clearFrame'});
 // Persist every taught action before issuing it. Never retry mutations automatically.
 await teachIntent(step);await perform(page,step);teaching.steps.push(step);teaching.selectedControl=undefined;
 frameEnabled=true;activeStep='Interactive teaching';send({type:'teachingUpdate',steps:teaching.steps,script:generateScript(teaching.sampleKey,teaching.flow.target,teaching.steps),selectedControl:null});
 send({type:'teachActionResult',requestId});
 }catch(e){frameEnabled=true;send({type:'teachActionResult',requestId,error:e instanceof Error?e.message:'Teaching action failed'});}
 finally{actionBusy=false;}
}
