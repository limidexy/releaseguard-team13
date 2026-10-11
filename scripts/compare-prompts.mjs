import { mkdir, writeFile } from 'node:fs/promises';
import { token } from './dev-tokens.mjs';
import { application, suite } from './fixtures.mjs';
import { required, completed, key, base } from './client.mjs';

// No paid work without a deliberate invocation. No fabricated fallback.
const mode=process.argv[2] ?? 'replay';
if(!['replay','real'].includes(mode))throw Error('Usage: node scripts/compare-prompts.mjs replay|real');
if(mode==='real' && process.env.RG_CONFIRM_REAL_CALLS!=='20')throw Error('Confirm up to 20 calls per normal attempt with RG_CONFIRM_REAL_CALLS=20. Worker recovery can repeat calls: configure provider-side spending limits first.');
const local=['localhost','127.0.0.1'].includes(new URL(base).hostname);
if(!local && (!process.env.RELEASEGUARD_TOKEN || process.env.RG_APPROVED_ORIGIN!==new URL(base).origin))throw Error('Cloud requires an explicit approved origin and scoped token');
const workspace='comparison-'+Date.now();
const t=process.env.RELEASEGUARD_TOKEN ?? await token('comparison-author','contributor',workspace);
const a=await required('applications',t,application),s=await required('suites',t,suite);
const report={schemaVersion:'2.1',createdAt:new Date().toISOString(),source:mode,cloud:!local,suiteId:s.id,appId:a.id,cases:suite.cases,policy:suite.policy,
  semanticConclusion:'NOT_ASSESSED: independent human review required',
  scope:mode==='replay'?'Static fixtures validate comparison plumbing only. Same fixture for both prompts; NO evidence of prompt improvement.':'Real provider experiment; retain errors and raw answers. One run per prompt is exploratory, not statistically conclusive.',runs:[]};
try {
  for(const promptVersion of ['v1','v2']) {
    const q=await required('jobs',t,{appId:a.id,suiteId:s.id,candidate:`support-${promptVersion}`,commitRef:process.env.RG_COMMIT_REF??'course-v2',source:mode,promptVersion,scenario:'passing'},key());
    const job=await completed(q.id,t,240000);report.runs.push(job);
    if(job.status!=='succeeded')process.exitCode=1;
  }
  report.caseComparison=suite.cases.map(c=>({caseId:c.id,prompt:c.prompt,critical:c.critical,
    versions:report.runs.map(j=>({promptVersion:j.input.promptVersion,caseResult:j.result?.results.find(r=>r.caseId===c.id)??null})),
    humanReview:{reviewer:null,policyAccuracy:null,safety:null,helpfulness:null,reason:null}}));
} catch(error){report.error=String(error);process.exitCode=1;}
finally{
  await mkdir('evidence/current',{recursive:true});const file=`evidence/current/prompt-comparison-${mode}-${Date.now()}.json`;
  await writeFile(file,JSON.stringify(report,null,2));console.log(file);console.log(report.scope);
}
