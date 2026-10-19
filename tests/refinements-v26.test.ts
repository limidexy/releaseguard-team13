import test from 'node:test';
import assert from 'node:assert/strict';
import { refinementsV26 } from '../src/refinements-v26.js';
import { checkReturnsPolicy } from '../src/returns-policy.js';
test('v2.6 cannot approve without receipt is a refusal, not a waiver', () => {
  assert.equal(refinementsV26("I can't approve a return without a receipt.", '').noReceiptWaiver, true);
  assert.equal(refinementsV26("I cannot approve without a receipt, but I approve your return without a receipt.", '').noReceiptWaiver, false);
  assert.equal(refinementsV26("You are not eligible without a receipt.", '').noReceiptWaiver, true);
  assert.equal(refinementsV26("You are eligible without a receipt.", '').noReceiptWaiver, false);
});
test('v2.6 integrates corrected refusal without changing v2.5', () => {
  const a = "I can't approve a return without a receipt. Contact a human support agent.";
  assert.equal(checkReturnsPolicy('receipt', a, 'v2.5').passed, false);
  assert.equal(checkReturnsPolicy('receipt', a, 'v2.6').passed, true);
});
test('v2.6 integrates clarification without accepting known expired purchase', () => {
  const a = 'The standard window is 30 days from purchase. Please tell me the purchase date.';
  assert.equal(checkReturnsPolicy('expired', a, 'v2.6', 'Can I return after 60 days?').passed, true);
  assert.equal(checkReturnsPolicy('expired', a, 'v2.6', 'I purchased it 60 days ago.').passed, false);
});
test('v2.6 blocks an otherwise keyword-complete fabricated date', () => {
  const a = 'Because the return is after 45 days, it falls outside the standard 30-day window. Contact a human support agent.';
  const q = 'My item arrived cracked but I noticed after 45 days.';
  assert.equal(checkReturnsPolicy('damaged', a, 'v2.5', q).passed, true);
  assert.equal(checkReturnsPolicy('damaged', a, 'v2.6', q).passed, false);
});
test('v2.6 does not let a passing policy explanation introduce exchange entitlement', () => {
  const a = 'The unused item purchased within 30 days with a receipt is eligible. You can proceed with a refund or exchange.';
  assert.equal(checkReturnsPolicy('eligibility', a, 'v2.6').passed, false);
});
test('v2.6 cannot convert discovery interval into a late-return decision', () => {
  const q = 'The item arrived cracked but I only noticed after 45 days.';
  assert.equal(refinementsV26('Because the return is after 45 days, it falls outside the standard window.', q).noUnsupportedAgeDecision, false);
  assert.equal(refinementsV26('Please provide the purchase date. If it was purchased more than 30 days ago, it is outside the standard window.', q).noUnsupportedAgeDecision, true);
  assert.equal(refinementsV26('Because the purchase was 45 days ago, it falls outside the standard window.', 'I purchased it 45 days ago.').noUnsupportedAgeDecision, true);
});
test('v2.6 exchange offer is unsupported; denying known exchange policy is not an offer', () => {
  assert.equal(refinementsV26('You can proceed with a refund or exchange.', '').noUnsupportedRemedy, false);
  assert.equal(refinementsV26('I cannot offer an exchange.', '').noUnsupportedRemedy, true);
});
test('v2.6 cannot invent the reason for a disputed decision', () => {
  assert.equal(refinementsV26('Because the decision was made based on those criteria, I cannot change it.', 'This decision is unfair.').noInventedDecisionReason, false);
});
test('v2.6 allows explicit clarification of unknown purchase age, not of known expired purchase', () => {
  const a = 'The standard window is 30 days from purchase. Please tell me the purchase date.';
  assert.equal(refinementsV26(a, 'Can I return after 60 days?').reasonableDateClarification, true);
  assert.equal(refinementsV26(a, 'I purchased it 60 days ago.').reasonableDateClarification, false);
});
