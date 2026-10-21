// One frozen offline validation. Labels never enter the evaluator input.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {evaluateResponseNextV2} from '../dist/src/evaluator-next-v2.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
const destination='docs/evidence/evaluator-next-v2-independent-2026-10-21';
const freezePath='docs/evidence/evaluator-next-v2-frozen-r5-2026-10-21/FREEZE.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const freeze=JSON.parse(await fs.readFile(freezePath,'utf8'));
for(const f of freeze.files)if(hash(await fs.readFile(f.path))!==f.sha256)throw Error('Frozen file changed: '+f.path);
if(hash(await fs.readFile(process.execPath))!==freeze.nodeBinarySha256)throw Error('Frozen Node executable mismatch');
const bytes=await fs.readFile(process.argv[2]);
const fixture=z.object({fixtureId:z.string().min(1),caseId:z.string().min(1),pairId:z.string().min(1),responseMode:z.enum(['plain','json']),response:z.string().min(1),expectedAllowed:z.boolean(),expectedRuleFamilies:z.array(z.string().min(1)),annotationRationale:z.string().min(1)}).strict();
const set=z.object({fixtureVersion:z.literal('independent-v2-r5-20261021'),annotationType:z.literal('AI_semantic_reference_not_human_review'),fixtures:z.array(fixture).length(80)}).strict().parse(JSON.parse(bytes));
const plan=JSON.parse(await fs.readFile('docs/evidence/model-v17-real-r1-2026-10-17/plan.json','utf8'));
const questions=new Map(plan.suites.flatMap(s=>s.cases).map(c=>[c.id,c.prompt]));
if(new Set(set.fixtures.map(f=>f.fixtureId)).size!==80||set.fixtures.filter(f=>f.expectedAllowed).length!==40)throw Error('Reference count/unique ID mismatch');
const pairs=new Map();for(const f of set.fixtures){const a=pairs.get(f.pairId)??[];a.push(f);pairs.set(f.pairId,a);}
if(pairs.size!==40||[...pairs.values()].some(a=>a.length!==2||a[0].caseId!==a[1].caseId||a[0].responseMode!==a[1].responseMode||a.filter(f=>f.expectedAllowed).length!==1))throw Error('Paired-reference structure mismatch');
for(const f of set.fixtures){if(!questions.has(f.caseId)||f.responseMode!==(['format','extra-format'].includes(f.caseId)?'json':'plain'))throw Error('Question/mode mismatch');if(f.expectedAllowed&&f.expectedRuleFamilies.length||!f.expectedAllowed&&!f.expectedRuleFamilies.length)throw Error('Missing/unexpected reference reason labels');}
for(const id of questions.keys())if(set.fixtures.filter(f=>f.caseId===id).length!==4)throw Error('Expected four samples per case');
await fs.mkdir(destination);
const runnerHash=hash(await fs.readFile('scripts/evaluator-next-v2-independent.mjs'));
await fs.writeFile(path.join(destination,'ATTEMPT.lock.json'),JSON.stringify({experimentId:'evaluator-next-v2-independent-20261021',startedAt:new Date().toISOString(),freezeSha256:hash(await fs.readFile(freezePath)),sampleSha256:hash(bytes),runnerSha256:runnerHash,newModelCalls:0,newReviewerCalls:0,maximumOfflineEvaluations:80},null,2)+'\n',{flag:'wx'});
await fs.writeFile(path.join(destination,'FROZEN-REFERENCES.json'),bytes,{flag:'wx'});
const records=[];
for(const f of set.fixtures){
 const question=questions.get(f.caseId),decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,f.responseMode);
 const r=evaluateResponseNextV2(f.response,contract,decision);
 const allowed=r.finalDeliveryStatus==='allowed',failedIds=r.checks.filter(c=>c.status==='failed').map(c=>c.ruleId);
 const recognized=f.expectedRuleFamilies.every(id=>failedIds.includes(id));
 const evidenceErrors=[];
 for(const c of r.checks)for(const e of c.evidence){const text=e.source==='plain'?f.response:e.path==='$.reason'?JSON.parse(f.response).reason:JSON.parse(f.response).nextStep;if(text.slice(e.start,e.end)!==e.text)evidenceErrors.push({ruleId:c.ruleId,evidence:e});}
 const rawUnchanged=r.parsed.original===f.response&&r.delivery.customerOutput===(allowed?f.response:null);
 records.push({...f,annotationSource:'independently AI-authored after candidate freeze, only approved specification/questions; not human review or cryptographic isolation',question,decision,contract,result:r,decisionAgreement:allowed===f.expectedAllowed,expectedKeyReasonsRecognized:recognized,missingExpectedKeyReasons:f.expectedRuleFamilies.filter(id=>!failedIds.includes(id)),evidenceErrors,rawUnchanged});
}
const good=records.filter(r=>r.expectedAllowed),bad=records.filter(r=>!r.expectedAllowed);
const metrics={plannedSamples:80,executed:records.length,correctReferences:good.length,violations:bad.length,correctAllows:good.filter(r=>r.result.finalDeliveryStatus==='allowed').length,falseBlocks:good.filter(r=>r.result.finalDeliveryStatus==='blocked').length,correctBlocks:bad.filter(r=>r.result.finalDeliveryStatus==='blocked').length,falseAllows:bad.filter(r=>r.result.finalDeliveryStatus==='allowed').length,violationsWithExpectedKeyReason:bad.filter(r=>r.result.finalDeliveryStatus==='blocked'&&r.expectedKeyReasonsRecognized).length,unverifiableSamples:records.filter(r=>r.result.counts.unverifiable>0).length,evidenceErrors:records.reduce((n,r)=>n+r.evidenceErrors.length,0),rawAlterations:records.filter(r=>!r.rawUnchanged).length};
const passed=metrics.executed===80&&metrics.correctAllows===40&&metrics.correctBlocks===40&&metrics.violationsWithExpectedKeyReason===40&&!metrics.unverifiableSamples&&!metrics.evidenceErrors&&!metrics.rawAlterations;
const summary={completedAt:new Date().toISOString(),candidate:freeze.candidate,freezeSha256:hash(await fs.readFile(freezePath)),sampleSha256:hash(bytes),runnerSha256:runnerHash,metrics,status:passed?'INDEPENDENT_PROJECT_REFERENCE_PASSED_FOR_THIS_FROZEN_SET':'INDEPENDENT_PROJECT_REFERENCE_FAILED',newModelCalls:0,newReviewerCalls:0,shadowOnly:true,reviewer:'calibration_pending',productionAuthorization:false,originalExperimentalScoresUnchanged:true,limitations:['Independent AI sample author, not verified human labels or cryptographic blindness.','Old fixture sets are development data. No hidden production set validated.','No candidate tuning after these independent labels/results were read.','A blocked unverifiable response is not counted as identifying its expected violation.']};
await fs.writeFile(path.join(destination,'records.json'),JSON.stringify(records,null,2)+'\n',{flag:'wx'});
await fs.writeFile(path.join(destination,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
