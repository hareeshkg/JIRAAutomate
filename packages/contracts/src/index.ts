import { createHash } from 'node:crypto';
import { z } from 'zod';
export const keySchema = z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/).max(64);
export const targetSchema = z.string().trim().min(1).max(100);
export type Target = z.infer<typeof targetSchema>;
export type Observation = {key:string; summary:string; type:string; from:string; target:Target; eligibility:'eligible'|'blocked'|'skipped'; reason:string};
export type Result = Observation & {state:string; reason:string; startedAt?:string; finishedAt?:string};
export type Plan = {id:string; hash:string; version:string; flowId?:string; target:Target; values:{resolution:string}; rows:Observation[]; rejected:string[]; duplicates:string[]; createdAt:string; expiresAt:string};
export type Run = {id:string; planId:string; version?:string; flowId?:string; validationFlowId?:string; state:string; target:Target; items:Result[]; createdAt:string; events:{sequence:number; at:string; message:string; key?:string}[]};
export const flowVersion = (target:Target) => `fixture-${target.toLowerCase()}-v1`;
export function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function parseKeys(input:string){
 if(Buffer.byteLength(input,'utf8')>1_000_000) throw new Error('Input exceeds 1 MB');
 const raw=input.split(/[\s,]+/).filter(Boolean); const keys:string[]=[], rejected:string[]=[], duplicates:string[]=[];
 for(const key of raw){if(!keySchema.safeParse(key).success)rejected.push(key);else if(keys.includes(key))duplicates.push(key);else keys.push(key);}
 if(!keys.length)throw new Error('Enter at least one valid issue key');
 if(keys.length>100)throw new Error('Maximum 100 unique issue keys');
 return {keys,rejected,duplicates};
}
export function parseCsv(input:string){
 if(Buffer.byteLength(input,'utf8')>1_000_000)throw new Error('CSV exceeds 1 MB');
 const lines=input.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(lines.shift()?.trim()!=='issueKey')throw new Error('CSV must have a single issueKey column');
 return lines.map(line=>{const cell=line.trim(); if(/^"[^"\r\n]*"$/.test(cell))return cell.slice(1,-1); if(cell.includes(',')||cell.includes('"'))throw new Error('Expected one issueKey per CSV row'); return cell;}).join('\n');
}
export function csvCell(value:unknown){let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function exportCsv(run:Run){return [['issueKey','from','target','result','reason','version','startedAt','finishedAt'],...run.items.map(i=>[i.key,i.from,i.target,i.state,i.reason,(run.version||flowVersion(run.target)),i.startedAt,i.finishedAt])].map(row=>row.map(csvCell).join(',')).join('\r\n');}
