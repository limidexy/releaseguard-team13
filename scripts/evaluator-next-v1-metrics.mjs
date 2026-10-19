import fs from 'node:fs';
import crypto from 'node:crypto';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
import {responseModeV8} from '../dist/src/provider.js';
import {evaluateResponseNextV1} from '../dist/src/evaluator-next-v1.js';
const read=p=>fs.readFileSync(p,'utf8'),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const plan=JSON.parse(read('docs/evidence/model-v17-real-r1-2026-10-17/plan.json')),prompts=new Map(plan.suites.flatMap(x=>x.cases).map(x=>[x.id,x.prompt]));
function evaluateSet(path,label,role){
 const fixtures=JSON.parse(read(path)).fixtures;let trueAllow=0,trueBlock=0,falseAllow=0,falseBlock=0,reasonExpected=0,reasonMatched=0,unverifiable=0;const unverifiableByRule={},layer={format:0,required:0,safety:0,extra:0,finalAllowed:0};
 const failures=[];
 for(const f of fixtures){const q=prompts.get(f.caseId),d=decisionForQuestionV1(q),c=compileResponseContractV17(q,d,responseModeV8(q)),r=evaluateResponseNextV1(f.response,c,d),allowed=r.finalDeliveryStatus==='allowed',actual=r.checks.filter(x=>x.status!=='passed').map(x=>x.ruleId);
  if(f.expectedAllowed&&allowed)trueAllow++;else if(!f.expectedAllowed&&!allowed)trueBlock++;else if(f.expectedAllowed)falseBlock++;else falseAllow++;
  reasonExpected+=f.expectedRuleFamilies.length;for(const x of f.expectedRuleFamilies)if(actual.includes(x))reasonMatched++;
  for(const x of r.checks.filter(x=>x.status==='unverifiable')){unverifiable++;unverifiableByRule[x.ruleId]=(unverifiableByRule[x.ruleId]??0)+1;}
  for(const key of ['format','required','safety','extra'])if(r.checks.filter(x=>x.category===key).every(x=>x.status==='passed'))layer[key]++;
  if(allowed)layer.finalAllowed++;
  if(allowed!==f.expectedAllowed||f.expectedRuleFamilies.some(x=>!actual.includes(x)))failures.push({fixtureId:f.fixtureId,caseId:f.caseId,expectedAllowed:f.expectedAllowed,actualAllowed:allowed,expectedRuleFamilies:f.expectedRuleFamilies,actualFailureRules:actual});
 }
 return {label,role,path,sha256:sha(path),total:fixtures.length,expectedAllowed:fixtures.filter(x=>x.expectedAllowed).length,expectedBlocked:fixtures.filter(x=>!x.expectedAllowed).length,trueAllow,trueBlock,falseAllow,falseBlock,correctReferenceAllowRate:trueAllow/fixtures.filter(x=>x.expectedAllowed).length,mutationBlockRate:trueBlock/fixtures.filter(x=>!x.expectedAllowed).length,finalDecisionAgreement:(trueAllow+trueBlock)/fixtures.length,failureReasonAgreement:reasonExpected?reasonMatched/reasonExpected:1,reasonExpected,reasonMatched,unverifiable,unverifiableByRule,layerIntersections:layer,failures};
}
const v1=evaluateSet('tests/evaluator-next-v1-holdout-fixtures.json','holdout-v1','converted-to-development-after-first-failure-and-used-for-fixes');
const v2=evaluateSet('tests/evaluator-next-v1-holdout-v2-fixtures.json','holdout-v2','unseen-at-candidate-r3-freeze; run once; not used for tuning');
const offline=JSON.parse(read('docs/evidence/evaluator-next-v1-2026-10-17/OFFLINE-REPORT-v1.json'));
const report={version:'evaluator-next-v1-acceptance-metrics',generatedAt:new Date().toISOString(),finalStatus:'EVALUATOR_NOT_READY',predeclaredThresholds:{correctReferenceAllowRate:1,mutationBlockRate:1,falseAllow:0,falseBlock:0,failureReasonAgreement:1,criticalUnverifiableOnSupportedExpressions:0,historicalReproduction:true},development:{mainReferenceTests:{completeReferencesAllowed:'40/40',singleDutyOmissionsBlocked:'20/20',appendedContradictionsBlocked:'20/20'},convertedV1Holdout:v1},unseenHoldout:v2,historicalAndR4PostHoc:offline.arms,decisionReasons:['The unseen v2 holdout misses the predeclared allow/block and failure-reason thresholds.','The post-hoc r4 diagnostic still disagrees with semantic reference annotations on both false allows and false blocks.','No new model or judge calls were made, and no old answer or score was changed.'],constraints:{providerInferenceCalls:0,judgeModelCalls:0,deployment:false,publication:false,gitPush:false,legacyEvaluatorModified:false,r4AnswersModified:false}};
fs.writeFileSync('docs/evidence/evaluator-next-v1-2026-10-17/ACCEPTANCE-METRICS-v1.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({finalStatus:report.finalStatus,v1:{trueAllow:v1.trueAllow,trueBlock:v1.trueBlock,falseAllow:v1.falseAllow,falseBlock:v1.falseBlock,reasonMatched:`${v1.reasonMatched}/${v1.reasonExpected}`},v2:{trueAllow:v2.trueAllow,trueBlock:v2.trueBlock,falseAllow:v2.falseAllow,falseBlock:v2.falseBlock,reasonMatched:`${v2.reasonMatched}/${v2.reasonExpected}`,unverifiable:v2.unverifiable},historicalAndR4PostHoc:offline.arms},null,2));
