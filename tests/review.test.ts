import test from 'node:test';
import assert from 'node:assert/strict';
import { decideReview } from '../src/contexts/review.js';

const pending = { status: 'pending', version: 1, gate: 'passed', creator: 'author', requester: 'requester' };
test('Review aggregate admits exactly one independent, versioned decision', () => {
  for (const decision of ['approved', 'rejected'] as const) {
    const result = decideReview(pending, { actor: 'reviewer', decision, expectedVersion: 1 });
    assert.deepEqual(result, { ok: true, status: decision, version: 2, action: decision === 'approved' ? 'ReleaseApproved' : 'ReleaseRejected' });
    assert.equal(decideReview({ ...pending, status: decision, version: 2 }, { actor: 'reviewer2', decision, expectedVersion: 2 }).ok, false);
  }
});
test('Review aggregate rejects creator, requester, stale version and blocked evidence', () => {
  for (const actor of ['author', 'requester']) assert.equal(decideReview(pending, { actor, decision: 'approved', expectedVersion: 1 }).ok, false);
  assert.deepEqual(decideReview(pending, { actor: 'reviewer', decision: 'approved', expectedVersion: 9 }), { ok: false, reason: 'Stale review version' });
  assert.equal(decideReview({ ...pending, gate: 'blocked' }, { actor: 'reviewer', decision: 'approved', expectedVersion: 1 }).ok, false);
});
