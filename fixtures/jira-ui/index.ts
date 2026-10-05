import type { FastifyInstance } from 'fastify';
import { builtins, type Workflow } from '../../packages/contracts/src/workflows.js';
import type { Store } from '../../apps/server/src/storage.js';
type Issue={key:string;summary:string;type:string;status:string;scenario:string};
export const seeds:Issue[] = Array.from({length:60},(_,i)=>({key:`DEMO-${i+1}`,summary:['Maintenance planning uplift','Technical document distribution','Ground operations integration','Asset records migration','Engineering portal improvements'][i%5],type:i===4?'Story':'Epic',status:i===2?'Implement':i===3?'Backlog':i===5?'Done':'Ready',scenario:i===6?'permission':i===7?'unknown-field':i===8?'timeout':i===9?'login':'normal'}));
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function fixture(app:FastifyInstance,store:Store,secret:string){
 for(const issue of seeds)store.db.prepare('INSERT OR IGNORE INTO fixture VALUES(?,?)').run(issue.key,JSON.stringify(issue));
 const transitions=()=>[...builtins,...store.list<Workflow>('flow')].filter((f,index,all)=>all.findIndex(other=>other.source===f.source&&other.label===f.label)===index);
 const read=(key:string)=>{const row=store.db.prepare('SELECT body FROM fixture WHERE key=?').get(key) as {body:string}|undefined;return row?JSON.parse(row.body) as Issue:undefined;};
 app.get('/fixture/browse/:key',async(req,reply)=>{
 if(req.headers['x-fixture-token']!==secret)return reply.code(403).send('Fixture browser authorization required');
 const i=read((req.params as {key:string}).key);if(!i)return reply.code(404).type('text/html').send('<h1>Issue not found</h1>');
 if(i.scenario==='login')return reply.type('text/html').send('<h1 data-testid="login-required">Fixture session expired</h1><p>This issue tests authentication interruption.</p>');
 const options=i.type==='Epic'&&i.scenario!=='permission'?transitions().filter(f=>f.source===i.status):[];
 return reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(i.key)} · Fixture Jira</title><style>body{font:15px system-ui;margin:0;color:#172b4d;background:#f4f5f7}nav{background:#0747a6;color:white;padding:18px}main{background:white;margin:30px;padding:28px;max-width:980px}button,select,input{font:inherit;padding:10px;margin:6px;border:1px solid #aaa;border-radius:4px}h1{font-size:26px}dt{color:#64748b;margin-top:20px}dialog{border:1px solid #ccc;border-radius:8px;min-width:360px}#menu{padding:12px;background:#eef2f7;width:200px}label{display:block;margin:12px 0}</style></head><body><nav>JIRA · Data Center 9 interaction fixture · Simulated issues</nav><main><p data-testid="issue-key">${esc(i.key)}</p><h1 data-testid="issue-summary">${esc(i.summary)}</h1><button id="status-menu" aria-haspopup="menu">${esc(i.status)} ▾</button><span data-testid="issue-status">${esc(i.status)}</span><div id="menu" role="menu" hidden>${options.map(t=>`<button role="menuitem" data-target="${esc(t.target)}" data-mode="${t.mode}">${esc(t.label)}</button>`).join('')}${!options.length?'<p>No transitions available</p>':''}</div><dl><dt>Issue type</dt><dd data-testid="issue-type">${esc(i.type)}</dd><dt>Project</dt><dd>DEMO Engineering</dd><dt>Description</dt><dd>Local fixture for workflow development. No corporate Jira connection.</dd></dl><p id="notice" role="status"></p></main><dialog id="dialog"><h2>Complete Epic</h2><label>Resolution <select id="resolution" required><option value="">Select resolution</option><option>Done</option></select></label>${i.scenario==='unknown-field'?'<label>Approval code <input required id="approval"></label>':''}<button id="submit">Complete</button><button id="cancel">Cancel</button><p id="error" role="alert"></p></dialog><script>
 const menu=document.getElementById('menu'),dialog=document.getElementById('dialog');let pendingTarget='Done';
 document.getElementById('status-menu').onclick=()=>menu.hidden=!menu.hidden;
 async function transition(target){const r=await fetch('/fixture/transition',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:${JSON.stringify(i.key)},target,resolution:document.getElementById('resolution').value})});if(!r.ok){document.getElementById('error').textContent=await r.text();return;}document.querySelector('[data-testid="issue-status"]').textContent=target;document.getElementById('status-menu').textContent=target+' ▾';menu.hidden=true;dialog.close();document.getElementById('notice').textContent='Issue updated';}
 document.querySelectorAll('[data-target]').forEach(b=>b.onclick=()=>{pendingTarget=b.dataset.target;if(b.dataset.mode==='resolution')dialog.showModal();else transition(pendingTarget)});
 document.getElementById('submit').onclick=()=>{if(!document.getElementById('resolution').value){document.getElementById('error').textContent='Resolution is required';return;}transition(pendingTarget)};document.getElementById('cancel').onclick=()=>dialog.close();
 </script></body></html>`);
 });
 app.post('/fixture/transition',async(req,reply)=>{
 if(req.headers['x-fixture-token']!==secret)return reply.code(403).send('Forbidden');
 const body=req.body as {key:string;target:string;resolution:string};const i=read(body.key);
 if(!i||i.type!=='Epic'||i.scenario==='permission')return reply.code(403).send('Transition denied');
 const transition=transitions().find(f=>f.source===i.status&&f.target===body.target);if(!transition)return reply.code(409).send('Transition unavailable');
 if(transition.mode==='resolution'&&(!body.resolution||i.scenario==='unknown-field'))return reply.code(422).send('Required fields incomplete');
 store.db.exec('BEGIN IMMEDIATE');try{i.status=body.target;store.db.prepare('UPDATE fixture SET body=? WHERE key=?').run(JSON.stringify(i),i.key);store.db.prepare('INSERT INTO mutations(key,target,at) VALUES(?,?,?)').run(i.key,body.target,new Date().toISOString());store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
 if(i.scenario==='timeout')await new Promise(resolve=>setTimeout(resolve,4500));
 return {status:i.status};
 });
}
