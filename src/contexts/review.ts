// Review bounded context: pure aggregate transition, independent of HTTP/storage.
// The caller must lock the current row and commit decision + audit atomically.
export function decideReview(
  current: { status: string; version: number; gate: string; creator: string; requester: string },
  command: { actor: string; decision: 'approved' | 'rejected'; expectedVersion: number },
): { ok: false; reason: string } | { ok: true; status: 'approved' | 'rejected'; version: number; action: string } {
  if (current.status !== 'pending' || current.gate !== 'passed' || command.actor === current.creator || command.actor === current.requester) {
    return { ok: false, reason: 'Independent pending review required' };
  }
  if (current.version !== command.expectedVersion) return { ok: false, reason: 'Stale review version' };
  return { ok: true, status: command.decision, version: current.version + 1,
    action: command.decision === 'approved' ? 'ReleaseApproved' : 'ReleaseRejected' };
}
