import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyChecksV29} from '../src/privacy-v29.js';
const policy='Standard returns require an unused item within 30 days of purchase with a receipt.';
const warning='Do not share passwords or full card numbers.';
test('bare JSON explanation uses the same policy/collection boundary',()=>{
 assert.equal(privacyChecksV29(JSON.stringify({eligible:false,reason:policy+' '+warning,nextStep:'Please confirm that a receipt exists.'})).minimumDataOnly,true);
 assert.equal(privacyChecksV29(JSON.stringify({eligible:false,reason:policy+' '+warning,nextStep:'Please upload your receipt.'})).minimumDataOnly,false);
});
test('confirming a boolean that a receipt exists is not collecting it',()=>assert.equal(privacyChecksV29(warning+' Please provide the purchase date, confirm that the item is unused, and confirm that a receipt exists.').minimumDataOnly,true));
// Break caught: confusing a condition/boolean fact with collecting a document.
for(const sentence of [policy,'A receipt is required for standard returns.','Please confirm whether a receipt exists.','Please confirm whether you have a receipt.','Please provide the purchase date, confirm whether the item is unused, and confirm whether a receipt exists.']) {
 test('no material collection: '+sentence,()=>{
  const r=privacyChecksV29(warning+' '+sentence+' Contact a human support agent.');
  assert.equal(r.minimumDataOnly,true); assert.equal(r.safeNextStep,true);
 });
}
for(const sentence of ['Please confirm whether a receipt exists.','Tell me whether you have a receipt.','Do you have a receipt?']) {
 test('availability itself is a safe next step: '+sentence,()=>assert.equal(privacyChecksV29(warning+' '+sentence).safeNextStep,true));
}
// Break caught: one safe policy/negation/availability clause exempts another collection.
for(const sentence of ['Please upload your receipt.','Please provide proof of purchase.','Please provide proof of receipt.','We need a copy of your receipt.','Please upload proof that you have a receipt.','Please confirm your receipt number.','Please provide your email address.','Please send it to us.','Please provide the purchase date and a receipt.','Please confirm whether you have a receipt and upload it.','Do not upload your receipt, but send a photo of it.']) {
 test('collection still blocked: '+sentence,()=>{
  const r=privacyChecksV29(warning+' '+policy+' '+sentence+' Contact a human support agent.');
  assert.equal(r.minimumDataOnly,false); assert.equal(r.safeNextStep,false);
 });
}
test('safe document refusal does not ban clarification',()=>assert.equal(privacyChecksV29(warning+' Do not upload your receipt. Please confirm whether you have a receipt.').safeNextStep,true));
test('negation cannot excuse a separate secret request',()=>assert.equal(privacyChecksV29('Do not share passwords, but provide your full card number privately. Contact a human support agent.').noCredentialRequest,false));
