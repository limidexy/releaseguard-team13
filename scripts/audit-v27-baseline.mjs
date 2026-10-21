import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluate } from '../dist/src/domain.js';
const dir = 'docs/evidence/model-v10-2026-10-16';
const plan = JSON.parse(await readFile(dir + '/plan.json'));
const reports = [
  ['v8','docs/evidence/model-v8-2026-10-16/real-v8-2026-10-16T03-12-52.872Z.json','8fa7c14eff269497bf426df60d0913976ff22352ec66b4e07740ca36bccd1af6'],
  ['v9','docs/evidence/model-v9-2026-10-16/real-v9-2026-10-16T04-12-25.436Z.json','d971bf3c34d1bd5125112385ddefade899785ecc3023e3c2aefb9a922dfedfdd'],
];
const cases = plan.suites.flatMap(s=>s.cases), runs=[];
for(const [version,path,expected] of reports) {
  const bytes=await readFile(path), sha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256,expected);
  const original=JSON.parse(bytes), oldRule='returns_policy_'+original.evaluatorVersion.replace('returns-policy-','').replace('.','_');
  assert.deepEqual(evaluate(cases.map(c=>({...c,rule:oldRule})),plan.policy,original.calls),original.overall);
  const v26=evaluate(cases.map(c=>({...c,rule:'returns_policy_v2_6'})),plan.policy,original.calls);
  const v27=evaluate(cases,plan.policy,original.calls);
  for(let i=0;i<v26.results.length;i++) {
    assert.deepEqual(v27.results[i].checks.slice(0,v26.results[i].checks.length),v26.results[i].checks);
    if(v26.results[i].status!=='passed') assert.notEqual(v27.results[i].status,'passed');
  }
  runs.push({version,sourceReport:path,sourceSha256:sha256,originalEvaluator:original.evaluatorVersion,originalScore:original.overall.score,v26,v27});
}
const output={createdAt:new Date().toISOString(),kind:'separate offline rescore of immutable historical real answers',newProviderCalls:0,evaluatorVersion:'returns-policy-v2.7',strictlyAdditiveChecks:true,planSha256:createHash('sha256').update(await readFile(dir+'/plan.json')).digest('hex'),runs};
await writeFile(dir+'/historical-offline-comparison.json',JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(runs.map(r=>({version:r.version,v26:r.v26.score,v27:r.v27.score,newFailures:r.v27.results.filter((v,i)=>v.status!=='passed'&&r.v26.results[i].status==='passed').map(v=>v.caseId)}))));
