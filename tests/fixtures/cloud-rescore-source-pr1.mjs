// Frozen original PR1 e94d4f1c1b438a90551c18f832c7844e1a822df2.
// Read only as text under controlled AsyncFunction capabilities, never imported.
// Integration check for a new evaluator, using retained provider answers verbatim.
// Always submits source=imported; this script never asks support to call a model.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {revisedReturnsSuite,returnsEvaluatorVersion} from '../dist/src/returns-policy.js';
import {evaluate,caseSchema} from '../dist/src/domain.js';
import {required,completed,base} from './client.mjs';
import {cloudToken} from './cloud-token.mjs';
if(process.env.RG_ALLOW_CLOUD_SMOKE!=='true'||new URL(base).protocol!=='https:'||!(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(',').includes(new URL(base).origin))throw Error('Approved trial origin required');
const raw=await readFile(process.argv[2]),original=JSON.parse(raw),hash=createHash('sha256').update(raw).digest('hex');
if(original.source!=='real'||original.runs?.length!==2||original.cases?.length!==10)throw Error('Expected two retained real jobs with ten cases');
const token=await cloudToken();
const definition={...revisedReturnsSuite({name:'Retained answers',description:'Re-evaluation without provider calls',cases:original.cases,policy:original.policy}),parentId:original.suiteId};
const suite=await required('suites',token,definition);
const report={at:new Date().toISOString(),kind:'CLOUD_IMPORTED_RESCORE',newProviderCalls:0,origin:base,sourceCommit:process.env.RG_COMMIT,image:process.env.RG_IMAGE,evaluatorVersion:returnsEvaluatorVersion,sourceReportSha256:hash,suiteId:suite.id,runs:[],passed:false,note:'Source=imported. Original real jobs, their scores and answers remain unchanged. This verifies the new evaluator in cloud; it is not another model experiment or human approval.'};
try{
 for(const j of original.runs){
  const outputs=j.result.results.map(r=>({caseId:r.caseId,...(typeof r.output==='string'?{output:r.output}:{}),...(r.latencyMs!==null?{latencyMs:r.latencyMs}:{}),...(r.status==='error'?{error:r.reason}:{})}));
  const idempotencyKey='rescore-'+createHash('sha256').update(hash+j.id+suite.id+returnsEvaluatorVersion).digest('hex');
  const queued=await required('jobs',token,{appId:original.appId,suiteId:suite.id,candidate:'retained-'+j.input.promptVersion+'-rescore-v2.1',commitRef:process.env.RG_COMMIT,source:'imported',outputs},idempotencyKey);
  const cloud=await completed(queued.id,token);
  report.runs.push({originalJobId:j.id,promptVersion:j.input.promptVersion,originalScore:j.result.score,job:cloud});
  assert.equal(cloud.status,'succeeded');assert.equal(cloud.input.source,'imported');
  const expected=evaluate(definition.cases.map(c=>caseSchema.parse(c)),definition.policy,outputs);
  assert.equal(cloud.result.score,expected.score);assert.equal(cloud.result.gate,expected.gate);
  for(const result of cloud.result.results)assert.equal(result.output,j.result.results.find(r=>r.caseId===result.caseId).output);
  console.log(JSON.stringify({originalJobId:j.id,importedJobId:cloud.id,score:cloud.result.score,gate:cloud.result.gate,newProviderCalls:0}));
 }
 report.passed=true;
}catch(e){report.error=String(e);process.exitCode=1;}
finally{await mkdir('evidence/current',{recursive:true});const file='evidence/current/cloud-retained-rescore-'+Date.now()+'.json';await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});console.log(file);}
