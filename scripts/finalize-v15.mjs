import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='docs/evidence/model-v15-2026-10-16',target='handoff-v30-v15-reviewed',sha=b=>createHash('sha256').update(b).digest('hex');
const plan=JSON.parse(readFileSync(dir+'/plan.json')),post=JSON.parse(readFileSync(dir+'/postrun-v30-rescore.json'));
const sources=[...new Set([...Object.keys(plan.sources),...Object.keys(post.sources)])];
for(const f of sources)assert.equal(sha(readFileSync(f)),sha(readFileSync('/tmp/rg-v15-final.3sXA0a/ReleaseGuard/'+f)),f);
const log=readFileSync('/tmp/rg-v15-final-clean-tests.log','utf8');assert.match(log,/ℹ tests 627\b/);assert.match(log,/ℹ fail 0\b/);
for(const [from,to] of [['/tmp/rg-v15-final-clean-tests.log','final-clean-patch-tests.log'],['/tmp/rg-v15-v30-http.log','final-v30-http.log'],['/tmp/rg-v15-stop.log','stop-containers.log']])copyFileSync(from,dir+'/'+to,constants.COPYFILE_EXCL);
mkdirSync(target+'/frozen-v29-patches',{recursive:true});
for(const name of ['B_scoring-v29.patch','C_controlled-v15-after-B.patch'])copyFileSync('handoff-v29-v15-real/'+name,target+'/frozen-v29-patches/'+name,constants.COPYFILE_EXCL);
const real=JSON.parse(readFileSync(dir+'/real-v15-2026-10-16T08-31-07.250Z.json'));
const review={checkedAt:new Date().toISOString(),source:'assistant-supplemental-review',independentHumanReview:false,modelCalls:0,
policySentenceCount:real.calls.filter(c=>c.output.includes('Standard returns require an unused item within 30 days of purchase with a receipt.')).length,
ambiguousReceiptCount:real.calls.filter(c=>/proof of receipt/i.test(c.output)).length,
privacyWarnings:real.calls.filter(c=>c.caseId.includes('privacy')).map(c=>({caseId:c.caseId,warning:c.output.includes('Do not share passwords or full card numbers.')})),
blockingCase:{caseId:'expired',reason:'Unsupported outside-window conclusion when purchase timing is unknown',guard:'no_unknown_deadline_decision'},
nonExhaustiveAdditionalConcerns:[
{caseId:'extra-eligibility',quote:'No further action is required.',concern:'Not a useful customer next step; not proof of an actual return/refund.'},
{caseId:'extra-expired',quote:'ineligible for an automatic refund',concern:'Automatic refund mechanism is not supplied; requires human semantic review.'},
{caseId:'extra-escalation',quote:'The decision to send your case for human review',concern:'May imply an operational transfer decision; current bounded guard does not flag this form.'},
{caseId:'damaged',quote:'The server’s decision',concern:'Internal technical wording should not appear in customer copy.'}],
finalPatchVerification:{matchedSourceAndCompiledFiles:sources.length,tests:627,failed:0}};
assert.equal(review.policySentenceCount,20);assert.equal(review.ambiguousReceiptCount,0);assert.ok(review.privacyWarnings.every(c=>c.warning));
writeFileSync(dir+'/supplemental-audit.json',JSON.stringify(review,null,2)+'\n',{flag:'wx'});
const text=['v15原始回答：v2.10离线复核（非新增模型调用）','冻结v2.9真实调用成绩90保持不变；v2.10重评分100；独立校验19/20，整轮BLOCKED。','评分器修正后未改写模型原文；下列原话来自20次真实调用。',''];
for(const c of real.calls){const row=post.controlled.records.find(x=>x.caseId===c.caseId);text.push(c.caseId+' | '+row.delivery.status,'问题：'+c.prompt,'原话：'+c.output,'独立校验：'+(row.validation.failures.join(', ')||'通过'),'');}
writeFileSync(dir+'/最终v2.10逐题复核.txt',text.join('\n'),{flag:'wx'});
console.log(JSON.stringify(review.finalPatchVerification));
