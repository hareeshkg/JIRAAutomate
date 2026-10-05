import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plan, Run } from '../../../packages/contracts/src/index.js';
export class Store {
 db:DatabaseSync;
 constructor(dir:string){mkdirSync(dir,{recursive:true,mode:0o700});this.db=new DatabaseSync(join(dir,'jira-bulk.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,body TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY,run_id TEXT NOT NULL,request_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS fixture(key TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mutations(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT,target TEXT,at TEXT);`);}
 put(kind:string,id:string,value:unknown){this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,id,JSON.stringify(value));}
 get<T>(kind:string,id:string):T|undefined{const row=this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
 list<T>(kind:string):T[]{return (this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as {body:string}[]).map(x=>JSON.parse(x.body));}
 event(run:Run,message:string,key?:string){run.events.push({sequence:run.events.length+1,at:new Date().toISOString(),message,key});this.put('run',run.id,run);}
 recover(){for(const session of this.list<any>('teaching')){if(['starting','recording'].includes(session.state))this.put('teaching',session.id,{...session,state:'interrupted',error:'Recording interrupted by application restart; no actions replayed'});}
 for(const run of this.list<Run>('run')){if(['running','queued','paused','pause_requested','stop_requested'].includes(run.state)){run.state='interrupted';for(const item of run.items){if(['executing','verifying'].includes(item.state)){item.state='outcome_uncertain';item.reason='Worker interrupted after mutation intent; reconcile before any further action';}else if(['pending','rechecking'].includes(item.state)){item.state='not_run';item.reason='Interrupted before mutation';}}this.event(run,'Application restarted; interrupted run retained for review');}}}
 plan(id:string){return this.get<Plan>('plan',id);}
}
