// Bounded subprocess boundary. Never launches anything on import. Full local
// acceptance is POSIX-only, allowing an owned process group to be terminated.
import { spawn } from 'node:child_process';
export function acceptanceProcess(command, args, options) {
  const timeout = options?.timeout, max = options?.maxBuffer ?? 10 * 1024 * 1024;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600000 || !Number.isInteger(max) || max < 1 || max > 10 * 1024 * 1024) {
    return Promise.resolve({ status: null, signal: null, error: { code: 'EINVAL' }, stdout: '', stderr: '' });
  }
  if (options.signal?.aborted) return Promise.resolve({ status: null, signal: null, error: { code: 'ABORT_ERR' }, stdout: '', stderr: '' });
  const grouped = process.platform !== 'win32';
  return new Promise(resolve => {
    let child, error, spawnFailed = false, closed = false, settled = false, terminating = false, grace, finalWait;
    let status = null, rawCloseCode = null, signal = null, outBytes = 0, errBytes = 0, stored = 0, outputTruncated = false;
    const out = [], err = [];
    function alive() { if (!grouped || !child?.pid) return false; try { process.kill(-child.pid, 0); return true; } catch { return false; } }
    function kill(sig) {
      if (!child?.pid) return;
      try { if (grouped) process.kill(-child.pid, sig); else child.kill(sig); } catch {}
    }
    function finish() {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(grace); clearTimeout(finalWait);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ status, rawCloseCode, signal, ...(error ? { error } : {}), stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'),
        stdoutBytes: outBytes, stderrBytes: errBytes, outputTruncated,
        processBoundary: error ? 'failed_or_unknown; no retry' : grouped ? 'root closed; no remaining owned process group observed' : 'root closed; Windows unit-only, descendant-group proof unavailable' });
    }
    const onAbort = () => terminate('ABORT_ERR');
    function terminate(code) {
      error ??= { code };
      if (terminating) return; terminating = true;
      kill('SIGTERM');
      grace = setTimeout(() => {
        // Even after the root closes, terminate any remaining owned descendants.
        kill('SIGKILL');
        if (closed) finish();
        else finalWait = setTimeout(() => { error = { code: 'CHILD_TERMINATION_UNKNOWN' }; finish(); }, 1000);
      }, 250);
    }
    function chunk(value, chunks, isOut) {
      const b = Buffer.from(value); if (isOut) outBytes += b.length; else errBytes += b.length;
      const available = Math.max(0, max - stored); if (available) { const saved = b.subarray(0, available); chunks.push(saved); stored += saved.length; }
      if (outBytes + errBytes > max) { outputTruncated = true; terminate('ENOBUFS'); }
    }
    const timer = setTimeout(() => terminate('ETIMEDOUT'), timeout);
    try { child = spawn(command, args, { ...options, signal: undefined, timeout: undefined, maxBuffer: undefined, encoding: undefined,
      detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { error = { code: e.code ?? 'UNKNOWN' }; closed = true; finish(); return; }
    child.stdout?.on('data', b => chunk(b, out, true)); child.stderr?.on('data', b => chunk(b, err, false));
    child.once('error', e => { spawnFailed = !child.pid; error ??= { code: e.code ?? 'UNKNOWN' }; });
    child.once('close', (code, sig) => {
      closed = true; rawCloseCode = Number.isInteger(code) ? code : null;
      status = !spawnFailed && Number.isInteger(code) && code >= 0 ? code : null; signal = sig ?? null;
      if (terminating) return; // The grace handler still owns descendant cleanup.
      if (alive()) { terminate('CHILDREN_UNKNOWN'); return; }
      finish();
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}
