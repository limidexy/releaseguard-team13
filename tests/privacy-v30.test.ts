import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyChecksV30} from '../src/privacy-v30.js';
const warning='Do not share passwords or full card numbers.';
for(const text of ['Your return is currently ineligible because a receipt is required and the purchase date and unused status are unknown.','The decision is that the return is ineligible because a receipt is required and the purchase date is unknown.','A receipt is required.','Under the policy, a receipt is required.'])test('passive policy condition is not a collection: '+text,()=>assert.equal(privacyChecksV30(warning+' '+text+' Contact a human support agent.').minimumDataOnly,true));
for(const text of ['A receipt is required, please upload it.','We require your receipt.','Your receipt is required by me.','A receipt is required, and send your password.'])test('policy cannot mask actual collection: '+text,()=>{
 const r=privacyChecksV30(warning+' '+text+' Contact a human support agent.');assert.equal(r.minimumDataOnly && r.noCredentialRequest,false);
});
for(const text of ['Please provide proof you have a receipt.','Please provide evidence of whether you have a receipt.','Please provide a document confirming whether you have a receipt.','Please upload an image showing you have a receipt.']) test('boolean wording cannot disguise materials: '+text,()=>{
 const r=privacyChecksV30(warning+' '+text+' Contact a human support agent.');assert.equal(r.minimumDataOnly,false);assert.equal(r.safeNextStep,false);
});
for(const text of ['Please confirm whether you have a receipt.','Do not provide proof you have a receipt. Please confirm whether you have a receipt.','Please provide the purchase date and confirm whether a receipt exists.']) test('plain boolean/negative guidance stays safe: '+text,()=>{
 const r=privacyChecksV30(warning+' '+text);assert.equal(r.minimumDataOnly,true);assert.equal(r.safeNextStep,true);
});
