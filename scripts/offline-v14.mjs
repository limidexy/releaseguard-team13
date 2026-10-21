import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluate} from '../dist/src/domain.js';
import {checkExplanationV2} from '../dist/src/output-guard-v2.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {responseModeV8,promptSnapshot} from '../dist/src/provider.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const old='docs/evidence/model-v13-2026-10-16/real-v13-2026-10-16T06-32-34.056Z.json';
const bytes=readFileSync(old),report=JSON.parse(bytes);
assert.equal(sha(bytes),'194efc1bfe9bbd2767ee7cb1c3c2f098b0289d74af4cb8e065a6975004488551');
const p=JSON.parse(readFileSync('docs/evidence/model-v13-2026-10-16/plan.json'));
assert.deepEqual(evaluate(p.suites.flatMap(s=>s.cases),p.policy,report.calls),report.overall);
assert.deepEqual(promptSnapshot('v13'),p.promptSnapshot);
for(const file of ['src/output-guard-v1.ts','src/returns-decision-v1.ts'])assert.equal(sha(readFileSync(file)),p.sources[file]);
for(const [file,hash] of Object.entries(p.frozenScorerBaseline))assert.equal(sha(readFileSync(file)),hash);
const expected={eligibility:false,receipt:false,damaged:false,expired:true,privacy:true,action:true,missing:true,escalation:false,format:true,greeting:true,'extra-eligibility':false,'extra-receipt':false,'extra-damaged':true,'extra-expired':false,'extra-privacy':false,'extra-action':true,'extra-missing':true,'extra-escalation':true,'extra-format':false,'extra-greeting':true};
const rows=report.calls.map(c=>{
 const after=checkExplanationV2(c.output,decisionForQuestionV1(c.prompt),responseModeV8(c.prompt),c.error);
 assert.equal(after.passed,expected[c.caseId],c.caseId+': '+after.failures.join(','));
 assert.equal(after.delivery.customerOutput,after.passed?c.output:null);
 assert.equal(after.delivery.rewritten,false);
 return {caseId:c.caseId,outputSha256:sha(c.output),before:c.metadata.guard,after,expected:expected[c.caseId],regressionPassed:true};
});
for(const id of ['receipt','expired','missing','greeting','extra-missing','extra-greeting']){
 assert.ok(!rows.find(r=>r.caseId===id).after.failures.includes('no_unsupported_eligibility'));
}
for(const id of ['escalation','extra-expired'])assert.ok(rows.find(r=>r.caseId===id).after.failures.includes('no_unsupported_action'));
assert.ok(rows.find(r=>r.caseId==='extra-eligibility').after.failures.includes('all_standard_conditions'));
assert.ok(rows.find(r=>r.caseId==='extra-privacy').after.failures.includes('explicit_user_privacy_warning'));
const log=readFileSync('/tmp/rg-v14-tests.log','utf8');
assert.match(log,/ℹ fail 0\b/);
const result={createdAt:new Date().toISOString(),source:'offline-replay',providerCalls:0,oldReportSha256:sha(bytes),oldRawScore:report.overall.score,scoringUnchanged:true,passed:true,regressions:rows.length,
testCount:Number(/ℹ tests (\d+)/.exec(log)[1]),testLogSha256:sha(log),
sourceHashes:Object.fromEntries(['src/output-guard-v2.ts','src/provider.ts','src/controlled-evaluation-v14.ts','src/worker.ts','src/domain.ts','src/support.ts'].map(f=>[f,sha(readFileSync(f))])),
rows,notes:['Corrected a false eligibility flag on receipt; it still lacks a direct purchase-date request and remains blocked.','Old raw model score is unchanged; offline guard results are not a new model evaluation.','Existing raw errors must remain blocked; passing this regression does not mean all 20 answers are good.']};
mkdirSync('docs/evidence/model-v14-2026-10-16',{recursive:true});
writeFileSync('docs/evidence/model-v14-2026-10-16/offline-regression.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,offlineCases:rows.length,modelCalls:0,oldRawScore:result.oldRawScore,tests:result.testCount,deliveryAllowed:rows.filter(r=>r.after.passed).length}));
