// Offline additive candidate. Never invokes a provider or activates formal delivery.
import {Ajv2020} from 'ajv/dist/2020.js';
import {buildStandardPolicyEvidenceR16} from '../../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/dist/src/standard-policy-evidence-r16.js';
import {projectPolicyUnitReadingsR15} from '../../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/dist/src/standard-policy-evidence-r15.js';
import {validateStandardPolicyEvidenceR12} from '../../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/dist/src/standard-policy-evidence-r12.js';
import {hasExplicitPeriodR5} from '../../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/dist/src/standard-policy-evidence-r5.js';
import {objectSha256} from '../../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/dist/src/hybrid-evaluation-v1.js';
import {inspectPropositionConsistencyC1} from '../../releaseguard-offline-consistency-c1-20261024/candidate/proposition-consistency-c1.mjs';
export const CONSISTENCY_C2='r16-consistency-c2-unenabled';
export const C2_INSTRUCTIONS='C2 clarification: attribution is proposition origin, not endorsement. Stance is the answerer commitment. Endorsing a customer/example waiver still endorses that waiver. Merely reporting or rejecting a waiver does not. Rejecting a requirement denies it regardless of origin. targetUnitId is the SAME earlier proposition being discussed/corrected, not a policy used to assess a case. For a new case conclusion use null. purchaseAnchor applies ONLY to general_policy + purchaseWindow + requirement; for case claims use not_applicable. Do not infer missing policy from case facts.';
export function buildConsistencyCandidateC2(input,config){
 const prior=buildStandardPolicyEvidenceR16(input,config),providerRequest=structuredClone(prior.providerRequest),request=structuredClone(prior.request);
 const schema=providerRequest.response_format.json_schema.schema;
 for(const u of Object.values(schema.properties.answerUnitFindings.properties)){
  const p=u.properties.reading.properties.claims.items.properties;
  const ids=p.targetUnitId.anyOf.flatMap(b=>b.type==='string'?b.enum:[]);
  p.targetUnitId={type:ids.length?['string','null']:'null',enum:[null,...ids]};
 }
 request.trustedInstructions+='\n\n'+C2_INSTRUCTIONS;providerRequest.messages[0].content=request.trustedInstructions;
 providerRequest.response_format.json_schema.name='releaseguard_policy_c2';
 return {...prior,revision:CONSISTENCY_C2,request,providerRequest,definitionHash:objectSha256({base:prior.definitionHash,revision:CONSISTENCY_C2,instructions:C2_INSTRUCTIONS}),schemaHash:objectSha256(schema),providerRequestHash:objectSha256(providerRequest)};
}
// No reading of English/reasons/ground-truth: reduce typed model assertions only.
export function projectPolicyPropositionsC2(findings){
 const observations={};
 for(const [id,u] of Object.entries(findings)){
  const r={affirmedConditions:[],deniedConditions:[],reportedOrRejectedConditions:[],caseConditions:[],unclearConditions:[],policyWindowAnchor:'not_applicable',reason:'C2 mechanical projection, not an original model total.'};
  const anchors=new Set();
  for(const c of u.reading.claims){
   if(c.condition==='overallEligibility')continue;
   if(c.scope==='unresolved'||c.attribution==='unresolved'||c.stance==='unresolved'){r.unclearConditions.push(c.condition);continue;}
   if(c.scope==='this_case'){r.caseConditions.push(c.condition);continue;}
   if(c.stance==='reported'||c.stance==='rejected'&&c.proposition==='waiver_or_relaxation'){r.reportedOrRejectedConditions.push(c.condition);continue;}
   if(c.proposition==='requirement'&&c.stance==='endorsed'){r.affirmedConditions.push(c.condition);if(c.condition==='purchaseWindow')anchors.add(c.purchaseAnchor);}
   if(c.proposition==='waiver_or_relaxation'&&c.stance==='endorsed'||c.proposition==='requirement'&&c.stance==='rejected')r.deniedConditions.push(c.condition);
  }
  r.policyWindowAnchor=anchors.has('other')?'other':anchors.has('unverifiable')?'unverifiable':anchors.has('purchase')?'purchase':'not_applicable';
  for(const k of ['affirmedConditions','deniedConditions','reportedOrRejectedConditions','caseConditions','unclearConditions'])r[k]=[...new Set(r[k])].sort();
  observations[id]={path:u.path,quote:u.quote,reading:r};
 }
 return {...projectPolicyUnitReadingsR15(observations),version:'policy-projection-c2',origin:'deterministic_projection_from_model_propositions_c2',mechanicalObservations:observations};
}
export function validateConsistencyCandidateC2(raw,input,config,metadata){
 const built=buildConsistencyCandidateC2(input,config),checker=new Ajv2020({allErrors:true,strict:false}).compile(built.providerRequest.response_format.json_schema.schema);
 const stop=(errors,stages,issues=[])=>({passed:false,schemaPassed:stages.schemaPassed,errors,stages,consistencyIssues:issues,derived:null,audit:null,projection:null,consistencyCandidate:CONSISTENCY_C2});
 if(!checker(raw))return stop((checker.errors??[]).map(e=>e.instancePath+': '+e.message),{schemaPassed:false});
 const issues=inspectPropositionConsistencyC1(raw.answerUnitFindings);
 if(issues.length)return stop(issues.map(e=>e.path+': '+e.code),{schemaPassed:true,propositionConsistencyPassed:false},issues);
 const ruleErrors=[],quoteErrors=[],policyErrors=[];
 const expected=new Set(input.applicableRules.filter(r=>r.ruleId!=='STANDARD_POLICY').map(r=>r.ruleId)),seen=new Set();
 for(const r of raw.ruleResults){if(!expected.has(r.ruleId))ruleErrors.push('Unknown rule '+r.ruleId);if(seen.has(r.ruleId))ruleErrors.push('Duplicate rule '+r.ruleId);seen.add(r.ruleId);}
 for(const id of expected)if(!seen.has(id))ruleErrors.push('Missing rule '+id);
 const fields={'$':input.originalResponse};
 if(input.responseMode==='json'){const x=JSON.parse(input.originalResponse);for(const k of ['reason','nextStep'])if(typeof x[k]==='string')fields['$.'+k]=x[k];}
 function inspect(v,at='raw'){
  if(Array.isArray(v)){const used=new Set();for(const [i,x]of v.entries()){
   if(x&&typeof x==='object'&&'path'in x&&'quote'in x){const key=JSON.stringify([x.path,x.quote]);if(used.has(key))quoteErrors.push(at+': duplicate evidence');used.add(key);}inspect(x,at+'.'+i);
  }return;}
  if(!v||typeof v!=='object')return;
  if('path'in v&&'quote'in v){const t=fields[v.path],s=t?.indexOf(v.quote)??-1;if(s<0||t.indexOf(v.quote,s+1)>=0)quoteErrors.push(at+': quote must occur exactly once');}
  for(const [k,x]of Object.entries(v))if(x&&typeof x==='object')inspect(x,at+'.'+k);
 }
 inspect(raw);
 for(const [id,u]of Object.entries(raw.answerUnitFindings))for(const c of u.reading.claims){
  if(c.condition==='overallEligibility'&&c.scope!=='this_case')policyErrors.push(id+': overallEligibility is case-only');
  if(c.scope==='general_policy'&&!['requirement','waiver_or_relaxation'].includes(c.proposition))policyErrors.push(id+': invalid general-policy proposition');
  if(c.scope==='this_case'&&!['satisfied','not_satisfied'].includes(c.proposition))policyErrors.push(id+': invalid case proposition');
  if(c.scope==='unresolved'&&c.proposition!=='unspecified')policyErrors.push(id+': unresolved scope must remain unspecified');
  const window=c.scope==='general_policy'&&c.condition==='purchaseWindow'&&c.proposition==='requirement';
  if(window){if(!hasExplicitPeriodR5(u.quote))policyErrors.push(id+': explicit30-day source required');if(c.purchaseAnchor==='not_applicable')policyErrors.push(id+': general window requires anchor');}
  else if(c.purchaseAnchor!=='not_applicable')policyErrors.push(id+': anchor on inapplicable claim');
 }
 const stages={schemaPassed:true,propositionConsistencyPassed:true,ruleSetPassed:!ruleErrors.length,evidencePassed:!quoteErrors.length,policyEvidencePassed:!policyErrors.length,downstreamPassed:null};
 const errors=[...ruleErrors,...quoteErrors,...policyErrors];if(errors.length)return stop(errors,stages);
 const projection=projectPolicyPropositionsC2(raw.answerUnitFindings);
 if(projection.ruleResult.evidence.length>12||projection.audit.wholeAnswer.evidence.length>12)return stop(['Evidence cap exceeded; never truncate'],stages);
 const {answerUnitFindings,...unchanged}=raw;
 const derivedWire={...unchanged,policyAudit:projection.audit,ruleResults:[...raw.ruleResults,projection.ruleResult]};
 const checked=validateStandardPolicyEvidenceR12(derivedWire,input,config,{...metadata,sourceMetadata:{...metadata.sourceMetadata,candidatePolicySubprotocol:CONSISTENCY_C2,policyStatusOrigin:projection.origin,rawModelPolicyStatusAbsent:true,modelPropositionsHash:objectSha256(answerUnitFindings),nonPolicyModelJudgmentsUnchanged:true}});
 return {...checked,stages:{...stages,downstreamPassed:checked.passed},projection,programDerivedWireForValidation:derivedWire,consistencyIssues:[],consistencyCandidate:CONSISTENCY_C2};
}
