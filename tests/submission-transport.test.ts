import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SubmissionTransport, configuredSubmissionConnectionLimit } from '../src/submission-transport.js';
import { newFetchTiming } from '../src/submission-state.js';

async function endpoint(t: TestContext, handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
function submit(transport: SubmissionTransport, url: string, signal: AbortSignal = AbortSignal.timeout(2000)) {
  return transport.submit(url, { 'content-type': 'application/json' }, '{"synthetic":true}', signal, newFetchTiming(), transport.timing());
}

test('submission transport returns the original upstream status and body exactly once', async t => {
  let requests = 0;
  const url = await endpoint(t, (req, res) => {
    requests++;
    assert.equal(req.method, 'POST');
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end('{"error":"limit"}');
  });
  const transport = new SubmissionTransport(); t.after(() => transport.close());
  const response = await submit(transport, url);
  assert.equal(response.status, 429); assert.equal(await response.text(), '{"error":"limit"}');
  assert.equal(requests, 1);
});

test('submission transport does not follow redirects or replay a dropped POST', async t => {
  let redirects = 0, drops = 0, followed = 0;
  const url = await endpoint(t, (req, res) => {
    if (req.url === '/redirect') { redirects++; res.writeHead(307, { location: '/destination' }); res.end('redirect'); }
    else if (req.url === '/drop') { drops++; req.socket.destroy(); }
    else { followed++; res.end('unexpected'); }
  });
  const transport = new SubmissionTransport(); t.after(() => transport.close());
  const response = await submit(transport, url + '/redirect');
  assert.equal(response.status, 307); assert.equal(await response.text(), 'redirect');
  await assert.rejects(submit(transport, url + '/drop'));
  assert.equal(redirects, 1); assert.equal(drops, 1); assert.equal(followed, 0);
});

test('an already cancelled submission never creates an upstream request', async t => {
  let requests = 0;
  const url = await endpoint(t, (_req, res) => { requests++; res.end('unexpected'); });
  const transport = new SubmissionTransport(); t.after(() => transport.close());
  const controller = new AbortController(), reason = new Error('synthetic cancellation');
  controller.abort(reason);
  await assert.rejects(submit(transport, url, controller.signal), error => error === reason);
  assert.equal(requests, 0);
});

test('a cancelled queued submission is never sent when a bounded socket becomes free', async t => {
  const paths: string[] = [];
  let releaseFirst!: () => void, firstReached!: () => void;
  const reached = new Promise<void>(resolve => { firstReached = resolve; });
  const url = await endpoint(t, (req, res) => {
    paths.push(req.url!);
    if (req.url === '/first') { releaseFirst = () => res.end('first'); firstReached(); }
    else res.end('third');
  });
  const transport = new SubmissionTransport(1); t.after(() => transport.close());
  const first = submit(transport, url + '/first'); await reached;
  const controller = new AbortController(), reason = new Error('synthetic queued cancellation');
  const cancelled = submit(transport, url + '/cancelled', controller.signal);
  const rejection = assert.rejects(cancelled, error => error === reason);
  controller.abort(reason); await rejection;
  const third = submit(transport, url + '/third');
  releaseFirst();
  assert.equal(await (await first).text(), 'first');
  assert.equal(await (await third).text(), 'third');
  assert.deepEqual(paths, ['/first', '/third']);
});

test('closing a transport rejects active and queued submissions and prevents later use', async t => {
  let firstReached!: () => void;
  const reached = new Promise<void>(resolve => { firstReached = resolve; });
  const url = await endpoint(t, () => firstReached());
  const transport = new SubmissionTransport(1); t.after(() => transport.close());
  const first = submit(transport, url); await reached;
  const queued = submit(transport, url);
  const rejections = [assert.rejects(first, /transport closed/), assert.rejects(queued, /transport closed/)];
  transport.close(); await Promise.all(rejections);
  await assert.rejects(submit(transport, url), /transport closed/);
});

test('submission response buffering stops at the configured byte bound', async t => {
  const url = await endpoint(t, (_req, res) => res.end('x'.repeat(1024)));
  const transport = new SubmissionTransport(1, 64); t.after(() => transport.close());
  await assert.rejects(submit(transport, url), /response exceeds size bound/);
});

test('submission connection limit is bounded and defaults above the old 16-socket ceiling', () => {
  assert.equal(configuredSubmissionConnectionLimit(undefined), 128);
  assert.equal(configuredSubmissionConnectionLimit('16'), 16);
  assert.equal(configuredSubmissionConnectionLimit('128'), 128);
  assert.equal(configuredSubmissionConnectionLimit('256'), 256);
  for (const value of ['0', '15', '257', '1.5', 'abc']) assert.throws(() => configuredSubmissionConnectionLimit(value));
});
