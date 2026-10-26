import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Fastify, { type FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { evaluate, suiteSchema } from '../src/domain.js';
import { revisedReturnsSuite, returnsSuiteV22 } from '../src/returns-policy.js';

// No real provider, database or running classroom service. Each route is injected.
const secret = 'synthetic-catalogue-test-secret-not-a-credential';
process.env.AUTH_MODE = 'dev'; process.env.ALLOW_DEV_AUTH = 'true';
process.env.AUTH_SECRET = secret; process.env.INTERNAL_SECRET = secret;
process.env.SERVICE_ROLE = 'support'; process.env.ALLOW_REAL_MODEL = 'false';
const { gateway } = await import('../src/gateway.js');
const { support } = await import('../src/support.js');
const legacyBytes = readFileSync('public/demo-fixtures.json', 'utf8');
const legacy = JSON.parse(legacyBytes);
const catalogues = [
  { path: '/returns-fixtures-v2.json', rule: 'returns_policy_v2_1', version: 'returns-policy-v2.1', suite: revisedReturnsSuite(legacy.suite) },
  { path: '/returns-fixtures-v2-2.json', rule: 'returns_policy_v2_2', version: 'returns-policy-v2.2', suite: returnsSuiteV22(legacy.suite) },
];

for (const c of catalogues) {
  test(c.path + ' is independently versioned and cannot overwrite old questions or policy', async () => {
    const app = Fastify(); await gateway(app);
    try {
      const response = await app.inject(c.path);
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type'] ?? '', /^application\/json/);
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      const result = response.json();
      assert.equal(suiteSchema.safeParse(result.suite).success, true);
      assert.deepEqual(result.application, legacy.application);
      assert.deepEqual(result.cases, result.suite.cases);
      assert.deepEqual(result.suite, c.suite);
      assert.equal(result.cases.length, 10);
      assert.ok(result.cases.every((item: any) => item.rule === c.rule));
      assert.deepEqual(result.cases.map((item: any) => [item.id, item.prompt, item.critical]), legacy.suite.cases.map((item: any) => [item.id, item.prompt, item.critical]));
      assert.deepEqual(result.suite.policy, legacy.suite.policy);
      assert.equal((await app.inject('/demo-fixtures.json')).body, legacyBytes);
      assert.equal(readFileSync('public/demo-fixtures.json', 'utf8'), legacyBytes);
    } finally { await app.close(); }
  });
}

// Execute the entire actual app.js. Only browser DOM/network boundaries are faked;
// the catalogue response comes from the real gateway, not a duplicate fixture.
class Element {
  value = ''; textContent = ''; className = ''; disabled = false; hidden = false; open = false;
  dataset: Record<string, string> = {}; children: Element[] = []; attributes = new Map<string, string>();
  onclick?: () => Promise<void>; onchange?: () => void;
  get options() { return this.children; }
  classList = { contains: (name: string) => this.className.split(' ').includes(name) };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  insertRow() { const row = new Element(); this.append(row); return row; }
  insertCell() { const cell = new Element(); this.append(cell); return cell; }
  addEventListener() {} focus() {}
}
function consoleHarness(app: FastifyInstance, language: string, unavailable = false, token = 'synthetic-ui-only') {
  const html = readFileSync('public/index.html', 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const get = (id: string) => { const element = elements.get(id); assert.ok(element, 'actual HTML must contain #' + id); return element; };
  get('language').value = language; get('source').value = 'replay'; get('token').value = token;
  const calls: { url: string; method: string; body?: any; headers?: HeadersInit }[] = [];
  const context = vm.createContext({
    AbortSignal, console, location: { hash: '' }, window: { addEventListener() {} },
    document: { getElementById: get, querySelectorAll: () => [], documentElement: { lang: '' }, createElement: () => new Element() },
    fetch: async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET', body = init.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url, method, body, headers: init.headers });
      if (url.endsWith('.json')) {
        if (unavailable) return new Response('{"error":"service_unavailable"}', { status: 503 });
        const r = await app.inject(url); return new Response(r.body, { status: r.statusCode });
      }
      if (url === '/api/v2/applications' && method === 'POST') return Response.json({ id: 'synthetic-app-id' });
      if (url === '/api/v2/suites' && method === 'POST') return Response.json({ id: 'synthetic-suite-id' });
      if (url === '/api/v2/jobs?limit=25&offset=0' || url === '/api/v2/releases') return Response.json([]);
      throw Error('Unexpected UI network operation: ' + method + ' ' + url);
    },
  });
  vm.runInContext(readFileSync('public/app.js', 'utf8'), context, { timeout: 1000 });
  return { calls, get, click: () => get('setup').onclick!() };
}
for (const language of ['zh', 'en']) {
  test('actual ' + language + ' console registers v2.2 only after a click, then reads history without submitting or reviewing', async () => {
    const app = Fastify(); await gateway(app);
    try {
      const h = consoleHarness(app, language);
      assert.equal(h.calls.length, 0, 'loading the page must not register or submit anything');
      await h.click();
      assert.deepEqual(h.calls.map(c => [c.method, c.url]), [
        ['GET', '/returns-fixtures-v2-2.json'], ['POST', '/api/v2/applications'], ['POST', '/api/v2/suites'],
        ['GET', '/api/v2/jobs?limit=25&offset=0'], ['GET', '/api/v2/releases'],
      ]);
      assert.deepEqual(h.calls[1].body, legacy.application);
      assert.deepEqual(h.calls[2].body, catalogues[1].suite);
      assert.equal(h.get('appId').value, 'synthetic-app-id'); assert.equal(h.get('suiteId').value, 'synthetic-suite-id');
      assert.equal(h.get('connection').open, false);
      assert.equal(h.get('message').textContent, language === 'en' ? 'Done. Evidence updated.' : '操作完成，证据已更新。');
      for (const c of h.calls.slice(1)) assert.equal(new Headers(c.headers).get('authorization'), 'Bearer synthetic-ui-only');
      assert.ok(h.calls.every(c => !c.url.includes('synthetic-ui-only')));
    } finally { await app.close(); }
  });
}
test('catalogue failure is reported without attempting asset registration, submission or review', async () => {
  const app = Fastify(); await gateway(app);
  try {
    const h = consoleHarness(app, 'en', true); await h.click();
    assert.deepEqual(h.calls.map(c => c.url), ['/returns-fixtures-v2-2.json']);
    assert.match(h.get('message').textContent, /^The request did not finish\./);
    assert.equal(h.get('appId').value, ''); assert.equal(h.get('suiteId').value, '');
    assert.equal(h.get('message').className, 'error');
  } finally { await app.close(); }
});
test('a missing token still prevents registration; choosing a catalogue does not grant an identity', async () => {
  const app = Fastify(); await gateway(app);
  try {
    const h = consoleHarness(app, 'en', false, ''); await h.click();
    assert.deepEqual(h.calls.map(c => c.url), ['/returns-fixtures-v2-2.json']);
    assert.equal(h.get('message').textContent, 'Enter an access token first'); assert.equal(h.get('connection').open, true);
  } finally { await app.close(); }
});

for (const catalogue of catalogues) for (const promptVersion of ['v1', 'v2']) for (const scenario of ['passing', 'failing', 'error']) {
  test(catalogue.version + ' ten-case ' + promptVersion + ' replay ' + scenario + ' records the real gate without a provider request', async () => {
    const app = Fastify(); await support(app);
    const authorization = 'Bearer ' + await new SignJWT({ caller: 'worker' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-services').setAudience('support').setIssuedAt().setExpirationTime('1m').sign(new TextEncoder().encode(secret));
    const savedFetch = globalThis.fetch; let networkCalls = 0;
    globalThis.fetch = async () => { networkCalls++; throw Error('Network is forbidden in replay regression'); };
    try {
      const r = await app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: { source: 'replay', promptVersion, scenario, cases: catalogue.suite.cases } });
      assert.equal(r.statusCode, 200); const execution = r.json();
      assert.equal(execution.outputs.length, 10); assert.deepEqual(execution.outputs.map((o: any) => o.caseId), legacy.suite.cases.map((c: any) => c.id));
      assert.equal(execution.provenance.source, 'replay'); assert.equal(execution.provenance.fixtureVersion, 'fictional-returns-v1');
      assert.equal(execution.provenance.promptVersion, promptVersion); assert.equal(execution.provenance.trust, 'labelled_static_fixture');
      assert.equal(execution.provenance.requestMetadata, undefined);
      const outputsBefore = structuredClone(execution.outputs), result = evaluate(suiteSchema.parse(catalogue.suite).cases, legacy.suite.policy, execution.outputs);
      assert.equal(result.total, 10); assert.equal(result.passed, scenario === 'passing' ? 10 : 9);
      assert.equal(result.score, scenario === 'passing' ? 100 : 90); assert.equal(result.gate, scenario === 'passing' ? 'passed' : 'blocked');
      assert.equal(result.criticalFailures, scenario === 'passing' ? 0 : 1); assert.equal(result.errors, scenario === 'error' ? 1 : 0);
      assert.deepEqual(execution.outputs, outputsBefore, 'evaluation must not repair the original replay evidence');
      for (const detail of result.results as any[]) {
        const output = execution.outputs.find((o: any) => o.caseId === detail.caseId);
        assert.equal(detail.output, output.output ?? null); assert.equal(detail.evaluatorVersion, catalogue.version);
        assert.equal(detail.evaluatorStatus, output.error ? 'not_run' : 'checked');
        if (output.error) { assert.equal(detail.reason, output.error); assert.deepEqual(detail.checks, []); }
      }
      assert.equal(networkCalls, 0);
    } finally { globalThis.fetch = savedFetch; await app.close(); }
  });
}
