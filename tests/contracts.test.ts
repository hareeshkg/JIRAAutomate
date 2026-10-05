import {describe,it,expect} from 'vitest';
import {parseKeys,parseCsv,csvCell,hash} from '../packages/contracts/src/index';
describe('bounded issue input',()=>{
 it('deduplicates while retaining rejected input',()=>{expect(parseKeys('DEMO-1, DEMO-2\nDEMO-1 https://jira/browse/DEMO-3 =1+1')).toEqual({keys:['DEMO-1','DEMO-2'],duplicates:['DEMO-1'],rejected:['https://jira/browse/DEMO-3','=1+1']})});
 it('rejects oversized batches and CSV with extra columns',()=>{expect(()=>parseKeys(Array.from({length:101},(_,i)=>`DEMO-${i}`).join('\n'))).toThrow('100');expect(()=>parseCsv('issueKey\nDEMO-1,Done')).toThrow();});
 it('accepts quoted single-column CSV',()=>expect(parseKeys(parseCsv('issueKey\r\n"DEMO-1"\r\nDEMO-2')).keys).toEqual(['DEMO-1','DEMO-2']));
 it('prevents spreadsheet formulas and quotes embedded delimiters',()=>{expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');expect(csvCell('a,"b"')).toBe('"a,""b"""');});
 it('binds values and selection to different hashes',()=>expect(hash({keys:['DEMO-1'],value:'Done'})).not.toBe(hash({keys:['DEMO-2'],value:'Done'})));
});
