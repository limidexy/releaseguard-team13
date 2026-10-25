import { createHmac, timingSafeEqual } from 'node:crypto';

export const SUBMISSION_BUDGET_MS = 10000;
export const SUBMISSION_BUDGET_HEADER = 'x-rg-submission-budget';
export const SUBMISSION_KEY_HASH_HEADER = 'x-rg-submission-key-sha256';
export type DeadlineTarget = 'evaluation' | 'registry';
export type SubmissionBinding = {
  traceId: string; method: string; route: string;
  keySha256: string; bodySha256: string; authorizationSha256: string;
};
type Clock = { wallNow: () => number; monotonicNow: () => number };
type Claims = SubmissionBinding & {
  v: 1; purpose: 'releaseguard.submission-deadline';
  iss: 'releaseguard-gateway'; aud: DeadlineTarget; caller: 'gateway' | 'evaluation';
  startedAtMs: number; deadlineAtMs: number;
};
export class InvalidSubmissionDeadlineError extends Error {
  constructor() { super('Invalid submission deadline context'); }
}
export class SubmissionDeadlineConfigurationError extends Error {
  constructor() { super('Submission deadline configuration unavailable'); }
}
export function configuredClockSkewBound(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw)) throw new SubmissionDeadlineConfigurationError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value >= SUBMISSION_BUDGET_MS) throw new SubmissionDeadlineConfigurationError();
  return value;
}
function secretKey(secret: string | undefined): string {
  if (!secret || secret.length < 32) throw new SubmissionDeadlineConfigurationError();
  return secret;
}
function bindingValid(b: SubmissionBinding): boolean {
  return /^[a-f0-9-]{36}$/.test(b.traceId) && ['POST', 'GET'].includes(b.method)
    && typeof b.route === 'string' && b.route.startsWith('/') && b.route.length < 3000
    && [b.keySha256, b.bodySha256, b.authorizationSha256].every(x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x));
}
export function createSubmissionDeadline(binding: SubmissionBinding, secret: string | undefined, startedAtMs: number, target: DeadlineTarget = 'evaluation'): string {
  const key = secretKey(secret);
  if (!bindingValid(binding) || !Number.isSafeInteger(startedAtMs) || startedAtMs <= 0 || !Number.isSafeInteger(startedAtMs + SUBMISSION_BUDGET_MS)) throw new InvalidSubmissionDeadlineError();
  const claims: Claims = { v: 1, purpose: 'releaseguard.submission-deadline', iss: 'releaseguard-gateway',
    aud: target, caller: target === 'evaluation' ? 'gateway' : 'evaluation',
    ...binding, startedAtMs, deadlineAtMs: startedAtMs + SUBMISSION_BUDGET_MS };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
}
export function receiveSubmissionDeadline(header: unknown, binding: SubmissionBinding, secret: string | undefined, clockSkewBoundMs: number,
  clock: Clock = { wallNow: Date.now, monotonicNow: () => performance.now() }, target: DeadlineTarget = 'evaluation') {
  const key = secretKey(secret);
  if (!Number.isSafeInteger(clockSkewBoundMs) || clockSkewBoundMs < 0 || clockSkewBoundMs >= SUBMISSION_BUDGET_MS) throw new SubmissionDeadlineConfigurationError();
  const invalid = () => { throw new InvalidSubmissionDeadlineError(); };
  if (!bindingValid(binding) || typeof header !== 'string' || header.length > 6000) return invalid();
  const parts = header.split('.');
  if (parts.length !== 2 || !parts.every(x => /^[A-Za-z0-9_-]+$/.test(x))) return invalid();
  const expected = createHmac('sha256', key).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return invalid();
  let c: Claims;
  try { c = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return invalid(); }
  if (!c || typeof c !== 'object' || Array.isArray(c) || c.v !== 1 || c.purpose !== 'releaseguard.submission-deadline'
    || c.iss !== 'releaseguard-gateway' || c.aud !== target || c.caller !== (target === 'evaluation' ? 'gateway' : 'evaluation')) return invalid();
  for (const field of ['traceId', 'method', 'route', 'keySha256', 'bodySha256', 'authorizationSha256'] as const) if (c[field] !== binding[field]) return invalid();
  const now = clock.wallNow();
  if (!Number.isSafeInteger(c.startedAtMs) || c.startedAtMs <= 0 || !Number.isSafeInteger(c.deadlineAtMs)
    || c.deadlineAtMs - c.startedAtMs !== SUBMISSION_BUDGET_MS || !Number.isFinite(now)
    || c.startedAtMs > now + clockSkewBoundMs) return invalid();
  // This deduction is conditional on an externally justified skew bound. No
  // default zero is assumed for different hosts. The localhost tests share one
  // OS clock; they do not establish a GKE clock guarantee.
  const receivedRemainingMs = Math.max(0, Math.min(SUBMISSION_BUDGET_MS, c.deadlineAtMs - now - clockSkewBoundMs));
  const monotonicDeadline = clock.monotonicNow() + receivedRemainingMs;
  const remainingMs = () => Math.max(0, monotonicDeadline - clock.monotonicNow());
  const controller = new AbortController();
  const timer = receivedRemainingMs > 0 ? setTimeout(() => controller.abort(), Math.ceil(receivedRemainingMs)) : undefined;
  timer?.unref(); if (receivedRemainingMs <= 0) controller.abort();
  return { startedAtMs: c.startedAtMs, deadlineAtMs: c.deadlineAtMs, remainingMs, expired: () => remainingMs() <= 0,
    signal: controller.signal, dispose: () => { if (timer) clearTimeout(timer); },
    publicState: () => ({ mode: 'authenticated_shared_internal_context', originalBudgetMs: SUBMISSION_BUDGET_MS,
      clockSkewBoundMs, receivedRemainingMs, remainingMs: remainingMs() }) };
}
