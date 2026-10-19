import { checkReturnsPolicy } from './returns-policy.js';

export const returnsEvaluatorVersionV27 = 'returns-policy-v2.7';
export function returnsSuiteV27<T extends { name: string; description: string; cases: { id: string; rule: string; expected: string }[] }>(suite: T) {
  return { ...suite, name: 'Fictional returns acceptance v2.7', description: 'returns-policy-v2.7: all v2.6 checks plus unsupported action-capability claims; human review required', cases: suite.cases.map(c => ({ ...c, rule: 'returns_policy_v2_7' })) };
}

// Additive, bounded English checks. No global negation exemption; old rules stay intact.
export function noUnsupportedActionCapability(raw: string) {
  const text = raw.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[‐‑–—]/g, '-').replace(/[*_`]/g, '').replace(/\s+/g, ' ');
  const action = '(?:forward|contact|connect|transfer|open|submit|escalate|process|issue|approve|overturn|change)\\b';
  const adverbs = '(?:(?:also|directly|personally|still|now)\\s+)*';
  const modality = '(?:(?:can|could|may|might|will|shall)\\s+' + adverbs + '(?:help(?: you)?(?: to)?\\s+)?|(?:am |are )?able to\\s+|have the ability to\\s+|(?:am |are )?going to\\s+)';
  const explicit = new RegExp("\\b(?:i|we)(?:'m|'re)?\\s+" + modality + adverbs + action);
  const offer = new RegExp('\\blet (?:me|us)\\s+' + adverbs + action);
  const inheritedSubject = new RegExp('\\b(?:i|we)\\b[^.!?;]{0,120}\\b(?:but|however|yet)\\s+(?:can|could|will)\\s+' + adverbs + action);
  const coordinatedAction = new RegExp('\\b(?:i|we)\\s+(?:can|could|will)\\s+(?:explain|describe|clarify|outline)\\b[^.!?;]{0,90}\\band\\s+' + adverbs + action);
  return ![explicit, offer, inheritedSubject, coordinatedAction].some(r => r.test(text));
}

export function checkReturnsPolicyV27(criterion: string, raw: string, question = '') {
  const baseline = checkReturnsPolicy(criterion, raw, 'v2.6', question);
  const checks = [...baseline.checks, { id: 'no_unsupported_action_capability', passed: noUnsupportedActionCapability(raw) }];
  const failed = checks.filter(c => !c.passed).map(c => c.id);
  return { checks, passed: failed.length === 0, reason: failed.length ? 'Policy checks failed: ' + failed.join(', ') : 'Versioned policy checks passed; human review required', evaluatorVersion: returnsEvaluatorVersionV27 };
}
