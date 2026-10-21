// Zero-network development comparison. A new evidence directory is required each time.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {evaluateResponseNextV1} from '../dist/src/evaluator-next-v1.js';
import {evaluateResponseNextV2} from '../dist/src/evaluator-next-v2.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
const destination=process.argv[2];if(!destination||!destination.startsWith('docs/evidence/evaluator-next-v2-'))throw Error('Use a new versioned v2 evidence directory');
await fs.mkdir(destination); // Deliberately refuses an existing directory.
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const plan=await read('docs/evidence/model-v17-real-r1-2026-10-17/plan.json');
const prompts=new Map(plan.suites.flatMap(s=>s.cases).map(c=>[c.id,c.prompt]));
const files=['tests/evaluator-next-v1-holdout-fixtures.json','tests/evaluator-next-v1-holdout-v2-fixtures.json'];
const records=[];
for(const file of files)for(const fixture of (await read(file)).fixtures){
 const question=prompts.get(fixture.caseId);if(!question)throw Error('Missing case');
 const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,fixture.responseMode);
 const evaluate=fn=>{const r=fn(fixture.response,contract,decision);const ids=r.checks.filter(x=>x.status!=='passed').map(x=>x.ruleId);return {allowed:r.finalDeliveryStatus==='allowed',failedRuleIds:ids,expectedReasonAgreement:fixture.expectedRuleFamilies.every(id=>ids.includes(id)),checks:r.checks};};
 records.push({fixtureFile:file,fixtureId:fixture.fixtureId,caseId:fixture.caseId,question,rawResponse:fixture.response,annotation:{expectedAllowed:fixture.expectedAllowed,expectedRuleFamilies:fixture.expectedRuleFamilies,rationale:fixture.annotationRationale,source:'retained AI-authored project semantic reference; converted to v2 development data'},contract,decision,old:evaluate(evaluateResponseNextV1),candidate:evaluate(evaluateResponseNextV2)});
}
const metrics=(rows,key)=>({total:rows.length,correctReferenceTotal:rows.filter(x=>x.annotation.expectedAllowed).length,violationTotal:rows.filter(x=>!x.annotation.expectedAllowed).length,correctAllows:rows.filter(x=>x.annotation.expectedAllowed&&x[key].allowed).length,falseBlocks:rows.filter(x=>x.annotation.expectedAllowed&&!x[key].allowed).length,correctBlocks:rows.filter(x=>!x.annotation.expectedAllowed&&!x[key].allowed).length,falseAllows:rows.filter(x=>!x.annotation.expectedAllowed&&x[key].allowed).length,expectedReasonMisses:rows.filter(x=>!x[key].expectedReasonAgreement).length});
const hashes={};for(const p of ['src/evaluator-next-v1.ts','src/semantic-evidence-next-v1.ts','src/evaluator-next-v2.ts','src/semantic-evidence-next-v2.ts','tests/evaluator-next-v2-development.test.ts',...files,'src/response-contract-v17.ts','src/returns-decision-v1.ts','src/worker.ts','package-lock.json']){try{hashes[p]=createHash('sha256').update(await fs.readFile(p)).digest('hex');}catch(e){if(e.code!=='ENOENT')throw e;}}
const summary={recordedAt:new Date().toISOString(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:hashes,newModelCalls:0,newReviewerCalls:0,formalWorkerUnchanged:true,independentValidation:'NOT_PERFORMED',readiness:'DEVELOPMENT_ONLY_NOT_RELEASE_QUALIFIED',sets:files.map(file=>({file,old:metrics(records.filter(x=>x.fixtureFile===file),'old'),candidate:metrics(records.filter(x=>x.fixtureFile===file),'candidate')}))};
await fs.writeFile(path.join(destination,'records.json'),JSON.stringify(records,null,2)+'\n',{flag:'wx'});
await fs.writeFile(path.join(destination,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
