import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {randomInt,randomUUID} from 'node:crypto';
import {boundAnswerViewsV1,bindAnswerSampleV1} from '../dist/src/answer-evaluation-binding-v1.js';
const destination='docs/evidence/hybrid-wire-v3-targeted-pairs-2026-10-21';
const source='docs/evidence/route-contract-alignment-2026-10-21';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const [bound,labels,pairSource]=await Promise.all(['TARGETED-PAIRS-BOUND.json','TARGETED-PAIRS-LABELS-SEPARATE.json','TARGETED-PAIR-SOURCE.json'].map(name=>json(source+'/'+name)));
if(bound.samples.length!==10||labels.labels.length!==10)throw Error('Expected exactly ten references');
const preserved=[];
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())await scan(path);else if(entry.isFile())preserved.push({path,sha256:hash(await readFile(path))});}}
for(const directory of ['src','tests','scripts','docs/evidence'])await scan(directory);
await mkdir(destination);
const save=async(name,data)=>writeFile(destination+'/'+name,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
await save('PRESERVATION-BEFORE.json',{at:new Date().toISOString(),files:preserved});
const experimentId='hybrid-wire-v3-targeted-pairs-20261021-'+randomUUID().slice(0,8);
const samples=bound.samples.map(sample=>{
 const label=labels.labels.find(row=>row.sampleId===sample.envelope.caseId);if(!label||label.bindingHash!==sample.bindingHash)throw Error('Source label binding mismatch');
 const id='s-'+randomUUID().replaceAll('-','').slice(0,16);
 const rebound=bindAnswerSampleV1({...sample.envelope,caseId:id,responseId:id,runId:experimentId},sample.provenance),views=boundAnswerViewsV1(rebound);
 if(!views.reviewerInput.applicableRules.some(rule=>rule.ruleId===label.criticalRuleId))throw Error('Critical rule does not apply');
 return {anonymousId:id,sourceSampleId:sample.envelope.caseId,bound:rebound,label:{...label,bindingHash:rebound.bindingHash},input:views.reviewerInput};
});
for(let index=samples.length-1;index>0;index--){const target=randomInt(index+1);[samples[index],samples[target]]=[samples[target],samples[index]];}
await save('PREPARED-SAMPLES.json',{experimentId,status:'REFERENCE_REVIEW_PENDING',source,samples:samples.map((sample,index)=>({...sample,sequence:index+1}))});
const independentInput={task:'Independently check all reference labels against the SAME policy, facts, decision and contract. No extractor or checker results are supplied. Verify every required/forbidden duty for positives, actual critical violation for negatives, applicability of criticalRuleId. Explain any substantive dispute. AI project reference only, not human blind review.',samples:samples.map(sample=>({anonymousId:sample.anonymousId,policy:sample.input.policy,facts:sample.input.facts,decision:sample.input.decision,contract:sample.input.contract,question:sample.input.originalQuestion,answer:sample.input.originalResponse,applicableRules:sample.input.applicableRules,reference:{expectedAllowed:sample.label.expectedAllowed,criticalRuleId:sample.label.criticalRuleId,expectedProposition:sample.label.expectedProposition}}))};
await save('REFERENCE-REVIEW-INPUT.json',independentInput);
await writeFile('/tmp/releaseguard-targeted-reference.GiqK15/REFERENCE-REVIEW-INPUT.json',JSON.stringify(independentInput,null,2)+'\n',{flag:'wx'});
await save('SOURCE-INVENTORY.json',{files:await Promise.all(['TARGETED-PAIR-SOURCE.json','TARGETED-PAIRS-BOUND.json','TARGETED-PAIRS-LABELS-SEPARATE.json'].map(async name=>({path:source+'/'+name,sha256:hash(await readFile(source+'/'+name))}))),originalInputsUnchanged:true,sampleCorrections:[],policy:pairSource.policy});
console.log(JSON.stringify({destination,experimentId,prepared:10,independentReviewInput:'/tmp/releaseguard-targeted-reference.GiqK15/REFERENCE-REVIEW-INPUT.json',modelCalls:0}));
