// Pure retained-record validation/derivation. Never repairs old answers, labels,
// scores, missing cases or reasons. Runtime evaluator is supplied after CLI guard.
import { isDeepStrictEqual as same } from 'node:util';
const deny=()=>{throw Error('Retained input invalid');};
export const retainedId=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function retainedOutputs(job){return (job.result?.results??[]).map(r=>({caseId:r.caseId,
 ...(typeof r.output==='string'?{output:r.output}:{}),...(r.latencyMs!=null?{latencyMs:r.latencyMs}:{}),
 ...(['error','not_run'].includes(r.status)?{error:r.reason||'Retained sample marked not_run'}:{})}));}
export function prepareRetained(source,c,runtime){
 const {domain,policy}=runtime;
 if(!source||!['2.1','2.2'].includes(source.schemaVersion)||source.source!=='real'||source.runs?.length!==2||source.cases?.length!==10||
  !retainedId(source.appId)||!retainedId(source.suiteId)||source.runId===c.runId||source.runs.some(j=>j?.id===c.runId)||source.workspace!==undefined&&source.workspace!==c.workspace||
  ['origin','declaredOrigin'].some(k=>source[k]!==undefined&&source[k]!==c.origin))deny();
 domain.policySchema.parse(source.policy);if(source.policy.minScore!==95)deny();
 const caseIds=new Set();for(const row of source.cases){domain.caseSchema.parse(row);if(!policy.returnsCriteria.includes(row.id)||caseIds.has(row.id))deny();caseIds.add(row.id);}
 const jobIds=new Set(),versions=new Set();let application,parent;
 for(const job of source.runs){
  if(!retainedId(job?.id)||jobIds.has(job.id)||!['queued','running','succeeded','failed'].includes(job.status)||job.workspace!==c.workspace||
   job.input?.source!=='real'||!['v1','v2'].includes(job.input.promptVersion)||versions.has(job.input.promptVersion)||job.input.appId!==source.appId||job.input.suiteId!==source.suiteId||
   job.snapshot?.application?.id!==source.appId||job.snapshot?.suite?.id!==source.suiteId||!Number.isInteger(job.snapshot.suite.version)||job.snapshot.suite.version<1||
   !same(job.snapshot.suite.data?.cases,source.cases)||!same(job.snapshot.suite.data?.policy,source.policy))deny();
  jobIds.add(job.id);versions.add(job.input.promptVersion);domain.jobSchema.parse(job.input);domain.suiteSchema.parse(job.snapshot.suite.data);
  if(application&&!same(application,job.snapshot.application)||parent&&!same(parent,job.snapshot.suite))deny();application=job.snapshot.application;parent=job.snapshot.suite;
  if(job.result!=null){
   const r=job.result;if(!Array.isArray(r.results)||r.results.length>10||r.total!==10||!Number.isFinite(r.score)||r.score<0||r.score>100||!['passed','blocked'].includes(r.gate))deny();
   const seen=new Set();for(const row of r.results){const original=source.cases.find(x=>x.id===row.caseId);
    if(!original||seen.has(row.caseId)||!['passed','failed','error','not_run'].includes(row.status)||row.rule!==original.rule||row.expected!==original.expected||row.critical!==original.critical||
     row.output!=null&&(typeof row.output!=='string'||row.output.length>10000)||row.latencyMs!=null&&(!Number.isFinite(row.latencyMs)||row.latencyMs<0||row.latencyMs>600000)||
     row.reason!=null&&(typeof row.reason!=='string'||row.reason.length>10000)||row.status==='error'&&(typeof row.reason!=='string'||!row.reason.length))deny();seen.add(row.caseId);
   }
  }
  for(const output of retainedOutputs(job))domain.outputSchema.parse(output);
 }
 const build=c.suiteRevision==='v2.1'?policy.revisedReturnsSuite:c.suiteRevision==='v2.2'?policy.returnsSuiteV22:null;
 if(!build)deny();const definition={...build({name:'Retained answers',description:'Re-evaluation without provider calls',cases:structuredClone(source.cases),policy:structuredClone(source.policy)}),parentId:source.suiteId};
 domain.suiteSchema.parse(definition);
 if(!same(definition.policy,source.policy)||!same(definition.cases.map(({rule,expected,...r})=>r),source.cases.map(({rule,expected,...r})=>r)))deny();
 const runs=source.runs.map(j=>{const outputs=retainedOutputs(j),byId=new Map((j.result?.results??[]).map(r=>[r.caseId,r]));return {
  originalJobId:j.id,promptVersion:j.input.promptVersion,originalJobStatus:j.status,originalResult:structuredClone(j.result??null),outputs,
  retainedExecution:source.cases.map(row=>({caseId:row.id,state:byId.has(row.id)?byId.get(row.id).status==='not_run'?'unexecuted':byId.get(row.id).status==='error'?'execution_error':'recorded':j.result==null?'unexecuted_or_result_unknown':'missing'})),
  expectedResult:domain.evaluate(definition.cases,definition.policy,outputs),state:'not_executed',importedJob:null,resultValidated:false};});
 return {definition,application:structuredClone(application),parentVersion:parent.version,evaluatorVersion:c.suiteRevision==='v2.1'?policy.returnsEvaluatorVersion:policy.returnsEvaluatorVersionV22,runs};
}
export function validateImported(job,{id,input,workspace,application,suiteId,version,definition,expectedResult}){
 if(job?.id!==id||job.workspace!==workspace||!same(job.input,input)||!['queued','running','failed','succeeded'].includes(job.status)||
  !Number.isInteger(job.attempts)||job.attempts<0||job.attempts>3||!same(job.snapshot?.application,application)||job.snapshot?.suite?.id!==suiteId||
  job.snapshot.suite.version!==version||!same(job.snapshot.suite.data,definition))deny();
 if(job.status==='succeeded'&&(!same(job.result,expectedResult)||!same(job.execution?.provenance,{source:'imported',trust:'caller_supplied'})))deny();
}
