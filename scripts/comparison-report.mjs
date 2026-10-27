// Pure report derivation. Runtime domain/evaluator implementations are supplied
// explicitly, so importing the operator entry needs neither dist nor credentials.
import { isDeepStrictEqual as same } from 'node:util';
const deny=()=>{throw Error('Comparison evidence invalid');};
export const promptVersions=Object.freeze(['v1','v2']);
export const legacyRevision=value=>value==='v2'?'v2.1':'legacy'; // Original PR1 meaning, NOT report format 2.2.
export function selectComparisonSuite(fixture,revision,runtime){
 if(!['legacy','v2.1','v2.2'].includes(revision)||!fixture||fixture.suite?.cases?.length!==10)deny();
 const legacy=runtime.domain.suiteSchema.parse(structuredClone(fixture.suite));
 if(legacy.policy.minScore!==95||legacy.policy.maxLatencyMs!==null||
  !same(legacy.cases.map(c=>c.id),runtime.policy.returnsCriteria)||!same(fixture.cases,legacy.cases))deny();
 const suite=revision==='legacy'?legacy:revision==='v2.1'?runtime.policy.revisedReturnsSuite(legacy):runtime.policy.returnsSuiteV22(legacy);
 runtime.domain.suiteSchema.parse(suite);
 if(!same(suite.policy,legacy.policy)||!same(suite.cases.map(({rule,expected,...c})=>c),legacy.cases.map(({rule,expected,...c})=>c)))deny();
 return {legacy,suite,evaluatorVersion:revision==='legacy'?'legacy-literal-v1':revision==='v2.1'?runtime.policy.returnsEvaluatorVersion:runtime.policy.returnsEvaluatorVersionV22};
}
export function originalOutputs(job){
 return (job.result?.results??[]).map(r=>({caseId:r.caseId,
  ...(typeof r.output==='string'?{output:r.output}:{}),...(r.latencyMs!=null?{latencyMs:r.latencyMs}:{}),
  ...(r.status==='error'?{error:r.reason}:r.status==='not_run'?{error:'Retained case not executed'}:{} )}));
}
export function validateComparisonJob(job,{id,input,workspace,application,suite},runtime){
 if(job?.id!==id||job.workspace!==workspace||!same(job.input,input)||
  job.snapshot?.application?.id!==input.appId||!same(job.snapshot.application.data,application)||
  job.snapshot?.suite?.id!==input.suiteId||!Number.isInteger(job.snapshot.suite.version)||job.snapshot.suite.version<1||!same(job.snapshot.suite.data,suite)||
  !['queued','running','failed','succeeded'].includes(job.status)||!Number.isInteger(job.attempts)||job.attempts<0||
  input.source==='real'&&job.attempts>1)deny();
 if(job.status!=='succeeded')return;
 const r=job.result,ids=suite.cases.map(c=>c.id);
 if(!r||r.results?.length!==10||new Set(r.results.map(c=>c.caseId)).size!==10||r.results.some(c=>!ids.includes(c.caseId)||
  !['passed','failed','error'].includes(c.status)||c.output!==null&&typeof c.output!=='string'||typeof c.reason!=='string'||
  c.status==='error'&&!c.reason.length))deny();
 for(const output of originalOutputs(job))runtime.domain.outputSchema.parse(output);
 // This consistency check never replaces or corrects the server's retained result.
 const computed=runtime.domain.evaluate(suite.cases,suite.policy,originalOutputs(job));
 if(!same(computed,r)||job.execution?.provenance?.source!==input.source||job.execution.provenance.promptVersion!==input.promptVersion)deny();
}
export function validateBaseline(baseline,legacy,runtime){
 if(!baseline||!['2.1','2.2'].includes(baseline.schemaVersion)||!['real','replay'].includes(baseline.source)||
  !same(baseline.cases,legacy.cases)||!same(baseline.policy,legacy.policy)||baseline.runs?.length!==2)deny();
 const seen=new Set();
 for(const [i,j]of baseline.runs.entries()){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(j?.id??'')||seen.has(j.id)||
   j.input?.promptVersion!==promptVersions[i]||j.input.source!==baseline.source||!['queued','running','failed','succeeded'].includes(j.status))deny();
  seen.add(j.id);for(const name of ['appId','suiteId'])if(baseline[name]!==undefined&&j.input[name]!==baseline[name])deny();
  if(j.result==null)continue;
  if(!Array.isArray(j.result.results)||j.result.results.length>10||!Number.isFinite(j.result.score)||j.result.score<0||j.result.score>100||!['passed','blocked'].includes(j.result.gate))deny();
  const ids=new Set();
  for(const row of j.result.results){
   const c=legacy.cases.find(c=>c.id===row.caseId);
   if(!c||ids.has(row.caseId)||!['passed','failed','error','not_run'].includes(row.status)||
    c.rule!==row.rule||c.expected!==row.expected||c.critical!==row.critical||
    row.output!=null&&typeof row.output!=='string'||row.status==='error'&&(typeof row.reason!=='string'||!row.reason.length))deny();
   ids.add(row.caseId);runtime.domain.outputSchema.parse(originalOutputs({result:{results:[row]}})[0]);
  }
 }
 return baseline;
}
export function comparisonReport({config,selected,runs,states,appId=null,suiteId=null,baseline=null,baselineSHA256=null,createdAt},runtime){
 const {suite,legacy,evaluatorVersion}=selected;
 const validated=runs.filter(j=>states.some(s=>s.id===j.id&&s.resultValidated===true));
 const report={schemaVersion:'2.2',runId:config.runId,createdAt,source:config.source,cloud:config.targetKind==='cloud',
  declaredOrigin:config.origin,workspace:config.workspace,commit:config.commit,image:config.image,identityDeclaredNotLiveAttestation:true,
  appId,suiteId,suiteRevision:config.suiteRevision,evaluatorVersion,cases:structuredClone(suite.cases),policy:structuredClone(suite.policy),
  semanticConclusion:'NOT_ASSESSED: independent human review required',shadowOnly:true,reviewer:'calibration_pending',
  scope:config.source==='replay'?'Same fixed answers for both prompts: comparison plumbing only, NO evidence of prompt improvement.'
   :'Exploratory real-provider experiment. Rule scores are not semantic accuracy or release approval.',
  plannedVersions:structuredClone(states),runs:structuredClone(runs),caseComparison:suite.cases.map(c=>({caseId:c.id,prompt:c.prompt,critical:c.critical,
   versions:promptVersions.map(promptVersion=>({promptVersion,caseResult:structuredClone(validated.find(j=>j.input?.promptVersion===promptVersion)?.result?.results?.find(r=>r.caseId===c.id)??null)})),
   humanReview:{reviewer:null,policyAccuracy:null,safety:null,helpfulness:null,reason:null}})),
  comparisonWarning:'Report format, evaluator version and prompt version are independent. Source, evaluator and output-budget differences prohibit direct score comparisons. Offline derivations are NOT new model calls; no independent human ratings.'};
 if(config.suiteRevision!=='legacy')report.legacyRulesOnNewAnswers=validated.map(j=>({id:j.id,promptVersion:j.input?.promptVersion,
  status:j.status,originalResult:structuredClone(j.result??null),derivedResult:runtime.domain.evaluate(legacy.cases,legacy.policy,originalOutputs(j)),derivedNotOriginal:true}));
 if(baseline){validateBaseline(baseline,legacy,runtime);report.baseline={sha256:baselineSHA256,createdAt:baseline.createdAt??null,source:baseline.source,
  originalRecordUnchanged:true,original:structuredClone(baseline),runs:baseline.runs.map(j=>({id:j.id,promptVersion:j.input.promptVersion,
   status:j.status,originalResult:structuredClone(j.result??null),rescoredResult:runtime.domain.evaluate(suite.cases,suite.policy,originalOutputs(j)),derivedNotOriginal:true})),
  missingOrUnexecutedCasesRemainErrors:true,directScoreComparisonPermitted:false};}
 return report;
}
