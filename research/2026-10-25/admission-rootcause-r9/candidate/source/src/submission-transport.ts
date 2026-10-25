import http from 'node:http';
import https from 'node:https';
import type { FetchTiming } from './submission-state.js';

export type SubmissionTransportTiming = {
  kind: 'native_http_bounded'; connectionLimit: number; socketAssignedMs: number | null;
  connectedMs: number | null; reusedSocket: boolean | null;
  activeAtEnqueue: number; pendingAtEnqueue: number;
};
// A per-gateway submission pool, not a business admission limit. The original
// absolute10s signal includes time queued here. No retry, redirect or new202.
export class SubmissionTransport {
  private readonly plain: http.Agent;
  private readonly secure: https.Agent;
  constructor(private readonly limit = 16) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid connection bound');
    const options = { keepAlive: true, maxSockets: limit, maxTotalSockets: limit, maxFreeSockets: limit, scheduling: 'fifo' as const };
    this.plain = new http.Agent(options); this.secure = new https.Agent(options);
  }
  close() { this.plain.destroy(); this.secure.destroy(); }
  async submit(url: string, headers: Record<string, string>, body: string, signal: AbortSignal,
    timing: FetchTiming, observed: SubmissionTransportTiming): Promise<{ status: number; text: () => Promise<string> }> {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid submission endpoint');
    if (signal.aborted) throw signal.reason;
    const secure = target.protocol === 'https:', agent = secure ? this.secure : this.plain;
    const count = (x: Record<string, unknown[] | undefined>) => Object.values(x).reduce((n, a) => n + (a?.length ?? 0), 0);
    observed.activeAtEnqueue = count(agent.sockets); observed.pendingAtEnqueue = count(agent.requests);
    timing.requestCreatedMs = performance.now() - timing.started;
    return new Promise((resolve, reject) => {
      // Node's native client does not retry a failed POST. Retain this property
      // instead of relying on generic fetch dispatcher retry/replay behavior.
      const request = (secure ? https : http).request(target, { method: 'POST', headers, agent, signal }, response => {
        timing.responseHeadersMs = performance.now() - timing.started;
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.once('aborted', () => { signal.removeEventListener('abort', cancel); reject(new Error('Incomplete submission response')); });
        response.once('error', error => { signal.removeEventListener('abort', cancel); reject(error); });
        response.once('end', () => {
          signal.removeEventListener('abort', cancel);
          timing.responseCompleteMs = performance.now() - timing.started;
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode!, text: async () => text });
        });
      });
      request.once('socket', socket => {
        observed.socketAssignedMs = performance.now() - timing.started;
        observed.reusedSocket = request.reusedSocket;
        if (!socket.connecting) observed.connectedMs = observed.socketAssignedMs;
        else socket.once(secure ? 'secureConnect' : 'connect', () => { observed.connectedMs = performance.now() - timing.started; });
      });
      request.once('finish', () => {
        // Local writable completion only; not peer receipt or database commit.
        timing.headersSentMs = performance.now() - timing.started; timing.bodySentMs = timing.headersSentMs;
      });
      // A queued ClientRequest may defer its error event until socket
      // assignment. Reject now; destroy also ensures it is never sent later.
      const cancel = () => { request.destroy(); reject(signal.reason ?? new Error('Submission aborted')); };
      signal.addEventListener('abort', cancel, { once: true });
      request.once('error', error => { signal.removeEventListener('abort', cancel); reject(error); });
      if (signal.aborted) cancel(); else request.end(body);
    });
  }
  timing(): SubmissionTransportTiming {
    return { kind: 'native_http_bounded', connectionLimit: this.limit, socketAssignedMs: null,
      connectedMs: null, reusedSocket: null, activeAtEnqueue: 0, pendingAtEnqueue: 0 };
  }
}
