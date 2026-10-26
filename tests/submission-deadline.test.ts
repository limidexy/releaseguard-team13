import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createSubmissionDeadline, receiveSubmissionDeadline, configuredClockSkewBound,
  InvalidSubmissionDeadlineError, SubmissionDeadlineConfigurationError,
  type SubmissionBinding,
} from '../src/submission-deadline.js';

const secret = 'synthetic-submission-test-key-not-a-real-secret';
const wall = 1800000000000;
const binding: SubmissionBinding = {
  traceId: '11111111-1111-4111-8111-111111111111', method: 'POST', route: '/jobs',
  keySha256: 'a'.repeat(64), bodySha256: 'b'.repeat(64), authorizationSha256: 'c'.repeat(64),
};
const claims = {
  v: 1, purpose: 'releaseguard.submission-deadline', iss: 'releaseguard-gateway',
  aud: 'evaluation', caller: 'gateway', ...binding, startedAtMs: wall - 200, deadlineAtMs: wall + 9800,
};
function sign(value: unknown, key = secret) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
}
const clock = (now = wall, mono = 500) => ({ wallNow: () => now, monotonicNow: () => mono });
const reject = (header: unknown, expected = binding) => assert.throws(
  () => receiveSubmissionDeadline(header, expected, secret, 100, clock()), InvalidSubmissionDeadlineError);

test('deadline wire format matches independent HMAC claims and deducts clock skew', () => {
  const header = createSubmissionDeadline(binding, secret, wall - 200);
  assert.equal(header, sign(claims));
  const deadline = receiveSubmissionDeadline(header, binding, secret, 100, clock());
  try {
    assert.equal(deadline.remainingMs(), 9700);
    assert.equal(deadline.expired(), false);
    assert.equal(deadline.signal.aborted, false);
  } finally { deadline.dispose(); }
});

test('deadline clock bound must be explicitly configured', () => {
  for (const raw of ['0', '100', '9999']) assert.equal(configuredClockSkewBound(raw), Number(raw));
  for (const raw of [undefined, '', '-1', '1.5', '+1', 'NaN', 'Infinity', '1e2', '10000', '9007199254740992']) {
    assert.throws(() => configuredClockSkewBound(raw), SubmissionDeadlineConfigurationError);
  }
  for (const bound of [-1, 0.5, NaN, Infinity, 10000]) {
    assert.throws(() => receiveSubmissionDeadline(sign(claims), binding, secret, bound, clock()), SubmissionDeadlineConfigurationError);
  }
});

test('deadline refuses missing or short signing secrets', () => {
  for (const key of [undefined, '', 'short']) {
    assert.throws(() => createSubmissionDeadline(binding, key, wall), SubmissionDeadlineConfigurationError);
    assert.throws(() => receiveSubmissionDeadline(sign(claims), binding, key, 0, clock()), SubmissionDeadlineConfigurationError);
  }
});

test('deadline binds the trace, method, route, key, body and authorization', () => {
  const replacements: SubmissionBinding = {
    traceId: '22222222-2222-4222-8222-222222222222', method: 'GET', route: '/other',
    keySha256: 'd'.repeat(64), bodySha256: 'e'.repeat(64), authorizationSha256: 'f'.repeat(64),
  };
  for (const [field, value] of Object.entries(replacements)) {
    reject(sign({ ...claims, [field]: value }));
    reject(sign(claims), { ...binding, [field]: value });
  }
});

test('deadline rejects invalid signatures, protocols and malformed envelopes', () => {
  for (const [field, value] of Object.entries({ v: 2, purpose: 'other', iss: 'other', aud: 'registry', caller: 'evaluation' })) {
    reject(sign({ ...claims, [field]: value }));
  }
  for (const header of [undefined, null, '', 123, ['not-a-string'], 'one-part', 'a.b.c', '*.*', 'a.', '.b', 'x'.repeat(6001)]) reject(header);
  reject(sign(claims, 'another-synthetic-secret-that-is-long-enough'));
  reject(sign(claims).split('.')[0] + '.' + Buffer.alloc(32, 1).toString('base64url'));
  reject(Buffer.from(JSON.stringify({ ...claims, deadlineAtMs: wall + 19800 })).toString('base64url') + '.' + sign(claims).split('.')[1]);
});

test('deadline rejects malformed times and future starts outside the skew bound', () => {
  for (const change of [
    { startedAtMs: String(wall - 200) }, { startedAtMs: wall - 199.5, deadlineAtMs: wall + 9800.5 },
    { startedAtMs: 0, deadlineAtMs: 10000 }, { startedAtMs: -1, deadlineAtMs: 9999 },
    { deadlineAtMs: String(wall + 9800) }, { deadlineAtMs: null },
    { deadlineAtMs: wall + 9799 }, { deadlineAtMs: wall + 9801 },
    { startedAtMs: wall + 101, deadlineAtMs: wall + 10101 },
  ]) reject(sign({ ...claims, ...change }));
  for (const time of [clock(NaN), clock(wall, NaN)]) {
    assert.throws(() => receiveSubmissionDeadline(sign(claims), binding, secret, 100, time), InvalidSubmissionDeadlineError);
  }
});

test('deadline uses monotonic elapsed time after receipt rather than moving wall time', () => {
  let now = wall, mono = 500;
  const deadline = receiveSubmissionDeadline(sign(claims), binding, secret, 100, {
    wallNow: () => now, monotonicNow: () => mono,
  });
  try {
    now -= 3600000; mono += 2300; assert.equal(deadline.remainingMs(), 7400);
    now += 7200000; mono += 7400; assert.equal(deadline.expired(), true);
  } finally { deadline.dispose(); }
});

test('expired deadline has no fresh budget and aborts immediately', () => {
  const deadline = receiveSubmissionDeadline(sign({ ...claims, startedAtMs: wall - 10000, deadlineAtMs: wall }), binding, secret, 0, clock());
  try { assert.equal(deadline.remainingMs(), 0); assert.equal(deadline.signal.aborted, true); }
  finally { deadline.dispose(); }
});

test('registry child keeps the original start and cannot be replayed at evaluation', () => {
  const child: SubmissionBinding = { ...binding, method: 'GET', route: '/internal/snapshot/app/suite?workspace=synthetic' };
  const header = createSubmissionDeadline(child, secret, wall - 200, 'registry');
  const deadline = receiveSubmissionDeadline(header, child, secret, 100, clock(wall + 1000, 1500), 'registry');
  try {
    assert.equal(deadline.startedAtMs, wall - 200);
    assert.equal(deadline.deadlineAtMs, wall + 9800);
    assert.equal(deadline.remainingMs(), 8700);
    reject(header, child);
  } finally { deadline.dispose(); }
});

test('deadline public timing excludes credentials and request binding', () => {
  const header = sign(claims), deadline = receiveSubmissionDeadline(header, binding, secret, 100, clock());
  try {
    const json = JSON.stringify(deadline.publicState());
    for (const value of [header, secret, ...Object.values(binding)]) assert(!json.includes(value));
  } finally { deadline.dispose(); }
});
