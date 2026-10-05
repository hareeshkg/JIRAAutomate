import { describe, it, expect } from 'vitest';
import { generateScript, normalizeScript } from '../apps/server/src/recording';
import type { RecordedStep } from '../packages/contracts/src/workflows';
const steps: RecordedStep[] = [
  {action:'click',locator:{kind:'css',value:'#status-menu'},effect:'read'},
  {action:'click',locator:{kind:'role',role:'menuitem',value:'Send for review'},effect:'mayMutate'},
];
const script = generateScript('DEMO-11','In Review',steps);
describe('reviewed recorder AST import',()=>{
  it('normalizes generated script without evaluating it',()=>expect(normalizeScript(script,'DEMO-11','In Review','Send for review')).toEqual(steps));
  it('rejects arbitrary code, redirects, missing verification and wrong transitions',()=>{
    expect(()=>normalizeScript(script.replace('await page.reload();','await page.evaluate(() => fetch("https://evil.example"));'),'DEMO-11','In Review')).toThrow('Unsupported');
    expect(()=>normalizeScript(script.replace('/fixture/browse/DEMO-11','https://evil.example'),'DEMO-11','In Review')).toThrow('navigation');
    expect(()=>normalizeScript(script.replace('await page.reload();',''),'DEMO-11','In Review')).toThrow('assertion');
    expect(()=>normalizeScript(script,'DEMO-11','In Review','Another transition')).toThrow('configured transition');
  });
  it('permits reviewed literal field values and rejects dynamic values',()=>{
    const recorded = generateScript('DEMO-11','Done',[...steps,{action:'selectOption',locator:{kind:'css',value:'#resolution'},value:'Done',effect:'read'}]);
    expect(normalizeScript(recorded,'DEMO-11','Done')).toHaveLength(3);
    expect(()=>normalizeScript(recorded.replace('selectOption("Done")','selectOption(process.env.SECRET)'),'DEMO-11','Done')).toThrow('literal');
  });
  it('rejects unsupported wrappers and malformed syntax',()=>{
    expect(()=>normalizeScript('while(true){}','DEMO-11','In Review')).toThrow();
    expect(()=>normalizeScript(script.slice(0,-4),'DEMO-11','In Review')).toThrow('syntax');
  });
});
