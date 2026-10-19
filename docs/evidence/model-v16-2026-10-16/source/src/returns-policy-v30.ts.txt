import {checkReturnsPolicyV28} from './returns-policy-v28.js';
import {privacyChecksV30} from './privacy-v30.js';
export const returnsEvaluatorVersionV30='returns-policy-v2.10';
export function returnsSuiteV30<T extends {name:string;description:string;cases:{id:string;rule:string;expected:string}[]}>(suite:T){
 return {...suite,name:'Fictional returns acceptance v2.10',description:'v2.8 safeguards plus scoped policy/receipt availability and explicit material-collection boundaries; human review required',cases:suite.cases.map(c=>({...c,rule:'returns_policy_v2_10'}))};
}
export function checkReturnsPolicyV30(criterion:string,raw:string,question=''){
 const baseline=checkReturnsPolicyV28(criterion,raw,question),privacy=privacyChecksV30(raw);
 const checks=baseline.checks.map(c=>({...c,passed:c.id==='safe_privacy_next_step'?privacy.safeNextStep:c.id==='minimum_necessary_data'?privacy.minimumDataOnly:c.passed}));
 // All old credential, warning, date, action, JSON and eligibility checks remain.
 // Material collection is not made safe by choosing another criterion.
 checks.push({id:'no_receipt_material_collection',passed:privacy.minimumDataOnly},
 {id:'unambiguous_receipt_availability',passed:! /\bproof\s+of\s+receipt\b/i.test(raw)});
 const failed=checks.filter(c=>!c.passed).map(c=>c.id);
 return {checks,passed:failed.length===0,reason:failed.length?'Policy checks failed: '+failed.join(', '):'Versioned policy checks passed; human review required',evaluatorVersion:returnsEvaluatorVersionV30};
}
