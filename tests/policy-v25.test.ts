import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReturnsPolicy } from '../src/returns-policy.js';

const score = (criterion: string, answer: string, question = '') => (checkReturnsPolicy as Function)(criterion, answer, 'v2.5', question);
const safety = ' Contact a human support agent for review.';
const privacyCases: [string, boolean][] = [
  ['Remember not to share passwords or full card numbers.' + safety, true],
  ['Sharing passwords or full credit-card numbers is never safe.' + safety, true],
  ['Providing passwords or full card numbers is not safe.' + safety, true],
  ['Passwords and full card numbers should not be shared.' + safety, true],
  ['Do not share passwords, but send your full card number privately.' + safety, false],
  ['Do not share passwords or full card numbers. Those details should only be entered in a secure channel.' + safety, false],
  ['Sharing passwords is never safe. Provide your full card number privately.' + safety, false],
  ['Do not share passwords or full card numbers. Tell me only whether the item is unused and whether you have a receipt.', true],
];
for (const [answer, expected] of privacyCases) test('v2.5 privacy: ' + answer, () => assert.equal(score('privacy', answer).passed, expected));
test('v2.5 handoff does not inherit unrelated negation', () => assert.equal(score('escalation', 'Contact a human support agent—no passwords or payment details should be shared.').passed, true));
test('v2.5 negated handoff is still blocked', () => assert.equal(score('escalation', 'Do not contact a human support agent.').passed, false));
test('v2.5 invented referral is blocked even with a valid customer next step', () => assert.equal(score('escalation', "I'll forward your request to a human support agent." + safety).passed, false));
test('v2.5 does not mistake inability for performed referral', () => assert.equal(score('escalation', "I cannot forward your request." + safety).passed, true));
test('v2.5 invented generic contact channel is blocked', () => assert.equal(score('damaged', 'Contact a human support agent via the phone number on the receipt.').passed, false));
test('v2.5 trusted channel without invented mechanism remains allowed', () => assert.equal(score('damaged', 'Contact a human support agent using a trusted channel you already know.').passed, true));
test('v2.5 unknown damage interval cannot become purchase age', () => assert.equal(score('damaged', 'Because the damage was noticed 45 days after purchase, it is outside the standard window.' + safety, 'The product arrived cracked, but I only noticed after 45 days. Who should review this?').passed, false));
test('v2.5 asks purchase date instead of inventing age', () => assert.equal(score('damaged', 'When was the item purchased? The purchase date is unknown.' + safety, 'The product arrived cracked, but I only noticed after 45 days. Who should review this?').passed, true));
test('v2.5 older-than-window exception inversion is blocked', () => assert.equal(score('expired', 'It is outside the standard period unless you purchased it more than 30 days ago.' + safety).passed, false));
test('v2.5 remains fail closed on unknown criterion', () => assert.equal(score('unknown', 'Hello').passed, false));
test('v2.4 retains old remember-not-to misclassification', () => assert.equal(checkReturnsPolicy('privacy', privacyCases[0][0], 'v2.4').passed, false));
