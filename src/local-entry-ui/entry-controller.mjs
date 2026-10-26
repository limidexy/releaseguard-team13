/**
 * Inactive, dev-only browser controller extracted from the earlier local entry.
 * No module-load DOM/network action, credentials, signing or application route.
 * The caller supplies trusted view/transport/time ports and an existing helper.
 * Client checks are not authentication, replay-only enforcement or JWT proof.
 */
const buttonMounts = new WeakMap(); // Ownership only; never retains credentials.

function localOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim()) throw new TypeError('Invalid local entry origin');
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Local entry requires a loopback HTTP origin without credentials, path, query or fragment');
  }
  return url.origin;
}

/** Explicitly mount onto a local button/status view; nothing is auto-mounted. */
export function createEntryController(config, ports) {
  const {role, workspace, timeoutMs = 10000, maxLifetimeSeconds = 900} = config;
  const helperOrigin = localOrigin(config.helperOrigin), appOrigin = localOrigin(config.appOrigin);
  if (!['viewer', 'contributor'].includes(role)
      || typeof workspace !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(workspace)
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
      || !Number.isInteger(maxLifetimeSeconds) || maxLifetimeSeconds < 1 || maxLifetimeSeconds > 900) {
    throw new TypeError('Invalid local entry role, workspace or time bounds');
  }
  const {button, status, fetcher, clipboard, now, setTimer, clearTimer, createAbortController} = ports;
  if (!button || typeof button.addEventListener !== 'function' || typeof button.removeEventListener !== 'function'
      || !status || [fetcher, now, setTimer, clearTimer, createAbortController].some(f => typeof f !== 'function')) {
    throw new TypeError('Local entry requires explicit view, transport and clock ports');
  }
  if (buttonMounts.has(button)) throw new TypeError('Local entry button is already mounted');
  const owner = {};
  const releaseMount = () => {
    if (buttonMounts.get(button) === owner) buttonMounts.delete(button);
  };
  let disposed = false, active = null;
  const initialDisabled = button.disabled;
  const endpoint = helperOrigin + '/token/' + role;
  const result = code => ({code}); // Never return the token, payload or raw error.
  const message = {
    generation_failed: 'Credential generation did not finish. Check the local helper before trying again manually.',
    generation_timeout: 'Credential generation timed out. No token was copied; check the local helper.',
    unauthorized: 'The local helper requires a valid local session. No token was copied.',
    forbidden: 'The local helper refused this request. Check its local origin and role settings.',
    rate_limited: 'The local helper is rate limited. Wait before trying again manually.',
    invalid_response: 'The local helper response did not match the requested identity or lifetime. No token was copied.',
    clipboard_unavailable: 'A credential was generated but not copied. Clipboard access is unavailable.',
    copy_failed: 'A credential was generated but the copy was not confirmed. Check clipboard permission before trying again manually.',
    expired: 'The credential lifetime elapsed before copying. Generate a fresh credential manually.',
    expired_after_copy: 'The credential was copied but has expired. Do not use it; generate a fresh one manually.',
  };
  function show(attempt, code, text = message[code]) {
    if (!disposed && active === attempt) status.textContent = text;
    return result(code);
  }
  function elapsed(attempt) {
    const current = now();
    if (!Number.isFinite(current) || current < attempt.lastTime) throw new Error('Invalid monotonic clock');
    attempt.lastTime = current;
    return current - attempt.started;
  }
  function stillCurrent(attempt) { return !disposed && active === attempt; }

  async function copy() {
    if (disposed) return result('disposed');
    if (active || button.disabled) return result('ignored');
    const attempt = {started: 0, lastTime: 0, timer: null, controller: null, phase: 'generation'};
    active = attempt;
    button.disabled = true;
    let token;
    try {
      attempt.started = attempt.lastTime = now();
      if (!Number.isFinite(attempt.started)) throw new Error('Invalid monotonic clock');
      attempt.controller = createAbortController();
      const signal = attempt.controller.signal;
      const aborted = new Promise((_, reject) => {
        attempt.abortListener = () => reject(new Error('Generation stopped'));
        signal.addEventListener('abort', attempt.abortListener, {once: true});
      });
      // Race both fetch and body parsing against ONE original deadline. An
      // uncooperative fetcher cannot hold the view busy or copy a late token.
      attempt.timer = setTimer(() => attempt.controller.abort(), timeoutMs);
      const withinGeneration = promise => Promise.race([promise, aborted]);
      show(attempt, 'generating', 'Generating a short-lived local credential. No evaluation or review is submitted.');
      const response = await withinGeneration(fetcher(endpoint, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal,
      }));
      if (!stillCurrent(attempt)) return result('disposed');
      if (signal.aborted || elapsed(attempt) >= timeoutMs) return show(attempt, 'generation_timeout');
      if (!response || response.ok !== true) {
        const code = {401: 'unauthorized', 403: 'forbidden', 429: 'rate_limited'}[response?.status] ?? 'generation_failed';
        return show(attempt, code); // Error bodies can contain secrets: never read them.
      }
      let payload = await withinGeneration(response.json());
      if (!stillCurrent(attempt)) return result('disposed');
      const spentMs = elapsed(attempt);
      if (signal.aborted || spentMs >= timeoutMs) return show(attempt, 'generation_timeout');
      if (!payload || Array.isArray(payload) || typeof payload.token !== 'string'
          || payload.token.length < 1 || payload.token.length > 16384 || /\s/.test(payload.token)
          || payload.role !== role || payload.workspace !== workspace
          || !Number.isInteger(payload.expiresInSeconds) || payload.expiresInSeconds < 1
          || payload.expiresInSeconds > maxLifetimeSeconds) return show(attempt, 'invalid_response');
      const lifetimeMs = payload.expiresInSeconds * 1000;
      // Conservatively deduct the whole request/body interval. This metadata
      // check does NOT inspect/sign/verify a JWT or prove server-side expiry.
      if (spentMs >= lifetimeMs) return show(attempt, 'expired');
      clearTimer(attempt.timer); attempt.timer = null;
      signal.removeEventListener('abort', attempt.abortListener);
      if (typeof clipboard?.writeText !== 'function') return show(attempt, 'clipboard_unavailable');
      attempt.phase = 'clipboard';
      token = payload.token;
      payload = null;
      // Clipboard writes cannot be retracted/cancelled. Keep the busy lock
      // until this write settles; never regenerate or race a second copy.
      const writing = clipboard.writeText(token);
      token = undefined;
      await writing;
      if (!stillCurrent(attempt)) return result('disposed');
      const remainingSeconds = Math.floor((lifetimeMs - elapsed(attempt)) / 1000);
      if (remainingSeconds < 1) return show(attempt, 'expired_after_copy');
      return show(attempt, 'copied', `Copied a ${role} credential with at most ${remainingSeconds} seconds remaining. Copying is not a connection. Open ${appOrigin}, paste into Access token, then Refresh workspace manually.`);
    } catch {
      if (!stillCurrent(attempt)) return result('disposed');
      return show(attempt, attempt.phase === 'clipboard' ? 'copy_failed'
        : attempt.controller?.signal.aborted ? 'generation_timeout' : 'generation_failed');
    } finally {
      token = undefined;
      if (attempt.timer !== null) clearTimer(attempt.timer);
      attempt.controller?.signal.removeEventListener('abort', attempt.abortListener);
      if (disposed && attempt.phase === 'clipboard') releaseMount();
      if (active === attempt) {
        active = null;
        if (!disposed) button.disabled = initialDisabled;
      }
    }
  }
  const onClick = event => { event.preventDefault(); void copy(); };
  buttonMounts.set(button, owner);
  try { button.addEventListener('click', onClick); }
  catch (error) { releaseMount(); throw error; }
  return {
    copy,
    dispose() {
      if (disposed) return;
      disposed = true;
      button.removeEventListener('click', onClick);
      if (active?.timer !== null && active?.timer !== undefined) clearTimer(active.timer);
      active?.controller?.abort();
      // A replacement must not race an uncancellable write from this mount.
      // Generation can be detached safely: stale callbacks cannot copy.
      if (active?.phase !== 'clipboard') releaseMount();
      active = null;
      button.disabled = initialDisabled;
      // An already-started clipboard write may finish; no success/expiry
      // status or new request is permitted after this view is disposed.
    },
  };
}
