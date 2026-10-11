import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { revisedReturnsSuite, returnsEvaluatorVersion } from '../dist/src/returns-policy.js';
import { evaluate } from '../dist/src/domain.js';
import { cloudToken } from './cloud-token.mjs';
import { token } from './dev-tokens.mjs';
import { application, suite as legacySuite } from './fixtures.mjs';
import { required, completed, key, base } from './client.mjs';

// No paid work without a deliberate invocation. No fabricated fallback.
const mode=process.argv[2] ?? 'replay';
if(!['replay','real'].includes(mode))throw Error('Usage: node scripts/compare-prompts.mjs replay|real');
if(mode==='real' && process.env.RG_CONFIRM_REAL_CALLS!=='20')throw Error('Explicit RG_CONFIRM_REAL_CALLS=20 required. Real jobs do not automatically repeat model calls after recovery.');
const revised=process.env.RG_SUITE_REVISION==='v2';
const suite=revised?revisedReturnsSuite(legacySuite):legacySuite;
const local=['localhost','127.0.0.1'].includes(new URL(base).hostname);
if(!local && (!process.env.RELEASEGUARD_TOKEN || process.env.RG_APPROVED_ORIGIN!==new URL(base).origin))throw Error('Cloud requires an explicit approved origin and scoped token');
const workspace='comparison-'+Date.now();
let t=process.env.RELEASEGUARD_TOKEN ?? await token('comparison-author','contributor',workspace);
const a=await required('applications',t,application),s=await required('suites',t,suite);
const report={schemaVersion:'2.2',createdAt:new Date().toISOString(),source:mode,cloud:!local,suiteId:s.id,appId:a.id,cases:suite.cases,policy:suite.policy,evaluatorVersion:revised?returnsEvaluatorVersion:'legacy-literal-v1',
  semanticConclusion:'NOT_ASSESSED: independent human review required',
  scope:mode==='replay'?'Static fixtures validate comparison plumbing only. Same fixture for both prompts; NO evidence of prompt improvement.':'Real provider experiment; retain errors and raw answers. One run per prompt is exploratory, not statistically conclusive.',runs:[]};
try {
  for(const promptVersion of ['v1','v2']) {
    if(!local && process.env.OIDC_CLIENT_SECRET)t=await cloudToken();
    const q=await required('jobs',t,{appId:a.id,suiteId:s.id,candidate:`support-${promptVersion}${revised?'-retest-v2':''}`,commitRef:process.env.RG_COMMIT_REF??'course-v2',source:mode,promptVersion,scenario:'passing'},key());
    console.log('Submitted '+promptVersion+' '+q.id+'; waiting for actual completion');
    const job=await completed(q.id,t,450000,mode==='real'?2000:150);report.runs.push(job);
    console.log(JSON.stringify({promptVersion,jobId:job.id,status:job.status,attempts:job.attempts,score:job.result?.score,gate:job.result?.gate,errors:job.result?.errors}));
    if(job.status!=='succeeded')process.exitCode=1;
    if(mode==='replay' && job.result?.gate!=='passed')process.exitCode=1;
  }
  report.caseComparison=suite.cases.map(c=>({caseId:c.id,prompt:c.prompt,critical:c.critical,
    versions:report.runs.map(j=>({promptVersion:j.input.promptVersion,caseResult:j.result?.results.find(r=>r.caseId===c.id)??null})),
    humanReview:{reviewer:null,policyAccuracy:null,safety:null,helpfulness:null,reason:null}}));
  if(revised){
    const outputs=j=>(j.result?.results??[]).map(r=>({caseId:r.caseId,...(typeof r.output==='string'?{output:r.output}:{}),...(r.latencyMs!==null?{latencyMs:r.latencyMs}:{}),...(r.status==='error'?{error:r.reason}:{})}));
    report.legacyRulesOnNewAnswers=report.runs.map(j=>({promptVersion:j.input.promptVersion,result:evaluate(legacySuite.cases,legacySuite.policy,outputs(j))}));
    if(process.env.RG_BASELINE_REPORT){
      const raw=await readFile(process.env.RG_BASELINE_REPORT),old=JSON.parse(raw);
      report.baseline={sha256:createHash('sha256').update(raw).digest('hex'),createdAt:old.createdAt,unchanged:true,runs:old.runs.map(j=>({id:j.id,promptVersion:j.input.promptVersion,originalResult:j.result,rescoredResult:evaluate(suite.cases,suite.policy,outputs(j))}))};
    }
    report.comparisonWarning='Output budget and evaluator changed. Scores are not directly comparable. Offline re-scoring preserves provider errors and does not constitute new calls. Prompts and questions unchanged; no independent human ratings.';
  }
} catch(error){report.error=String(error);process.exitCode=1;}
finally{
  await mkdir('evidence/current',{recursive:true});const file=`evidence/current/prompt-comparison-${mode}-${Date.now()}.json`;
  await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});console.log(file);console.log(report.scope);
}
