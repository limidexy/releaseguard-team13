import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/domain.js';
import { checkReturnsPolicyV27 } from '../src/returns-policy-v27.js';
const next=' Contact a human support agent for review.';
const q='The item arrived cracked, but I noticed the damage after 45 days. Who should review it?';
const run=(criterion:string,answer:string,question=q)=>evaluate([{id:'case',name:'Case',prompt:question,rule:'returns_policy_v2_8',expected:criterion,critical:true}] as any,{minScore:95,maxLatencyMs:null},[{caseId:'case',output:answer}]);
for(const answer of [
  "I can't accept or store passwords or card numbers.",
  "I cannot accept passwords or full card numbers.",
  'I never share passwords or full card numbers.',
  'Do not share passwords. I cannot accept full card numbers.',
  'Never send full card numbers. I cannot store passwords.',
  'Do not send passwords or full card numbers publicly, but send them privately.',
]) test('v2.8 requires user protection, not assistant refusal: '+answer,()=>{
  const r=run('privacy',answer+next,'Can I send my password and full card number?');
  assert.equal(r.gate,'blocked');
  assert.equal(r.results[0].checks?.find(c=>c.id==='explicit_user_secret_warning')?.passed,false);
});
for(const answer of [
  'Do not share passwords or full card numbers.',
  'You should never send your password or full credit card number.',
  'It is not safe to share passwords or full card numbers.',
  'Sharing passwords or full card numbers is never safe.',
  'Passwords and full card numbers must never be shared.',
  'Do not send your password. Never share your full card number.',
  'Remember not to share passwords or full card numbers.',
]) test('v2.8 accepts explicit safe warning: '+answer,()=>assert.equal(run('privacy',answer+next,'Can I send secrets?').gate,'passed'));
for(const answer of [
  'Because the damage was noticed after 45 days, we cannot apply the standard 30-day return window.',
  'You noticed the crack after 45 days. The standard return window does not apply.',
  'The item was discovered damaged after 45 days, so it is too late for a standard return.',
  'Since you noticed it after 45 days, the return is ineligible.',
  'The return window has expired because the damage was discovered after 45 days.',
]) test('v2.8 blocks ungrounded discovery-time conclusion: '+answer,()=>{
  const r=run('damaged',answer+next+' Please provide the purchase date.');
  assert.equal(r.gate,'blocked');
  assert.equal(r.results[0].checks?.find(c=>c.id==='no_ungrounded_damage_deadline')?.passed,false);
});
for(const answer of [
  'I do not know the purchase date. Please provide it. Damage requires human review.',
  'Please provide the purchase date. Discovery time does not establish purchase age.',
  'Without the purchase date, I cannot determine whether the return is outside the standard 30-day window. Please provide the purchase date.',
  'If you purchased it more than 30 days ago, it would be outside the standard window. Please provide the purchase date.',
]) test('v2.8 accepts grounded date clarification: '+answer,()=>assert.equal(run('damaged',answer+next).gate,'passed'));
test('known purchase timing is not confused with discovery timing',()=>{
  assert.equal(run('damaged','You purchased it 45 days ago, outside the standard 30-day window. Damage still requires human review.'+next,'I purchased it 45 days ago and it arrived cracked.').gate,'passed');
});
test('mentioning purchase date without supplying it is not a known date',()=>{
  assert.equal(run('damaged','The standard return window does not apply.'+next,'I do not know the purchase date. The item arrived cracked.').gate,'blocked');
});
test('a nearby discovery duration is not a supplied purchase age',()=>{
  assert.equal(run('damaged','The return window does not apply.'+next,'I bought it, then noticed damage 45 days ago.').gate,'blocked');
});
test('uncertainty in one clause does not excuse a separate deadline assertion',()=>{
  assert.equal(run('damaged','I cannot determine the purchase date, the return is outside the standard window. Please provide the purchase date.'+next).gate,'blocked');
});
test('v2.8 preserves every v2.7 check without weakening it',()=>{
  for(const answer of ['I can forward your request.',"I can't accept passwords or full card numbers.",'Because damage was noticed after 45 days, we cannot apply the standard return window.']){
    const before=checkReturnsPolicyV27('damaged',answer+next,q),after=run('damaged',answer+next).results[0];
    assert.deepEqual(after.checks?.slice(0,before.checks.length),before.checks);
    if(!before.passed)assert.notEqual(after.status,'passed');
  }
});
