// Offline manifest generation only: no process, credential read or network call.
// Clock skew is an operator-supplied bound, not a measured cloud guarantee.
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerPauseInitProgram } from './worker-pause-init.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function invalid() { throw Error('Invalid render configuration'); }
function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f]/.test(value)) invalid();
  return value;
}
function https(value, originOnly = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || value.includes('?') || value.includes('#') ||
      url.hostname.replace(/\.$/, '').endsWith('.invalid') || originOnly && url.pathname !== '/') invalid();
  return originOnly ? url.origin : value;
}
function flag(name) {
  const value = process.env[name];
  if (value === undefined || value === '' || value === 'false') return false;
  if (value !== 'true') invalid();
  return true;
}
async function directory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('Unsafe output directory');
}
let phase = 'configuration';
try {
  const image = required('RG_IMAGE');
  if (!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image) || image.includes('://')) invalid();
  const origin = https(required('PUBLIC_ORIGIN'), true), issuer = https(required('AUTH_ISSUER')), jwks = https(required('OIDC_JWKS_URL'));
  const skew = required('SUBMISSION_CLOCK_SKEW_BOUND_MS'), bound = Number(skew);
  if (!/^\d+$/.test(skew) || !Number.isSafeInteger(bound) || bound < 0 || bound >= 10000) invalid();
  const ca = flag('RG_INTERNAL_CA'), small = flag('RG_TRIAL_SMALL'), skipNamespace = flag('RG_SKIP_NAMESPACE'), faultFixture = flag('RG_ENABLE_WORKER_FAULT_FIXTURE');
  const configured = process.env.RG_DEPLOYMENT_ENV;
  if (configured && !['gcp-trial', 'unconfirmed'].includes(configured)) invalid();
  const namespace = 'releaseguard', documents = [], roles = ['registry', 'evaluation', 'governance', 'support', 'worker', 'gateway'];
  if (!skipNamespace) documents.push({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace } });
  const data = {
    AUTH_MODE: 'oidc', AUTH_ISSUER: issuer, OIDC_JWKS_URL: jwks, PUBLIC_ORIGIN: origin,
    RUNNER_ORIGINS: 'http://support:8080', REGISTRY_URL: 'http://registry:8080',
    EVALUATION_URL: 'http://evaluation:8080', GOVERNANCE_URL: 'http://governance:8080', LEASE_MS: '60000',
    SUBMISSION_CLOCK_SKEW_BOUND_MS: skew,
    ...(configured === 'gcp-trial' ? { RG_DEPLOYMENT_ENV: 'gcp-trial' } : {}),
  };
  documents.push({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'rg-config', namespace }, data });
  const fromSecret = (name, key, optional = false) => ({ secretKeyRef: { name, key, optional } });
  for (const role of roles) {
    const env = [{ name: 'SERVICE_ROLE', value: role }, { name: 'INTERNAL_SECRET', valueFrom: fromSecret('rg-internal', 'INTERNAL_SECRET') }];
    // Future isolated fault fixture only; no default deployment or signal tool.
    if (faultFixture && role === 'worker') env.push({ name: 'RG_TRIAL_POD_UID', valueFrom: { fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.uid' } } });
    if (ca) env.push({ name: 'NODE_EXTRA_CA_CERTS', value: '/trust/ca.crt' });
    if (['registry', 'evaluation', 'governance', 'worker'].includes(role)) env.push({ name: 'DATABASE_URL', valueFrom: fromSecret('rg-' + (role === 'worker' ? 'evaluation' : role), 'DATABASE_URL') });
    if (['evaluation', 'worker'].includes(role)) env.push({ name: 'AMQP_URL', valueFrom: fromSecret('rg-broker', 'AMQP_URL') });
    if (role === 'support') for (const name of ['MODEL_API_URL', 'MODEL_API_KEY', 'MODEL_ID', 'ALLOW_REAL_MODEL']) env.push({ name, valueFrom: fromSecret('rg-provider', name, true) });
    const labels = { app: role, 'app.kubernetes.io/part-of': 'releaseguard' };
    const container = {
      name: role, image, imagePullPolicy: 'IfNotPresent', envFrom: [{ configMapRef: { name: 'rg-config' } }], env,
      ...(faultFixture && role === 'worker' ? { command: ['/usr/local/bin/node', '-e', workerPauseInitProgram] } : {}),
      ports: [{ containerPort: 8080 }],
      resources: { requests: { cpu: small ? role === 'worker' ? '150m' : '100m' : '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '384Mi' } },
      securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
      startupProbe: { httpGet: { path: '/health/ready', port: 8080 }, periodSeconds: 5, failureThreshold: 30 },
      readinessProbe: { httpGet: { path: '/health/ready', port: 8080 }, periodSeconds: 5 },
      livenessProbe: { httpGet: { path: '/health/live', port: 8080 }, periodSeconds: 10 },
      ...(ca ? { volumeMounts: [{ name: 'trust', mountPath: '/trust', readOnly: true }] } : {}),
    };
    const pod = {
      automountServiceAccountToken: false, terminationGracePeriodSeconds: 30,
      securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000 },
      containers: [container], ...(ca ? { volumes: [{ name: 'trust', secret: { secretName: 'rg-internal-ca' } }] } : {}),
    };
    if (faultFixture && role === 'worker') {
      pod.securityContext.fsGroup = 1000;
      pod.volumes = [...(pod.volumes ?? []), { name: 'worker-fault-journal', emptyDir: { medium: 'Memory', sizeLimit: '1Mi' } }];
      container.volumeMounts = [...(container.volumeMounts ?? []), { name: 'worker-fault-journal', mountPath: '/run/releaseguard-fault' }];
    }
    documents.push({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: role, namespace }, spec: {
      replicas: role === 'gateway' ? 2 : 1, strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
      selector: { matchLabels: { app: role } }, template: { metadata: { labels }, spec: pod },
    } });
    documents.push({ apiVersion: 'v1', kind: 'Service', metadata: { name: role, namespace }, spec: { selector: { app: role }, ports: [{ port: 8080, targetPort: 8080 }], type: 'ClusterIP' } });
  }
  phase = 'output';
  let output = root;
  for (const segment of ['deploy', 'k8s', 'rendered']) { output = join(output, segment); await directory(output); }
  // Never overwrite an old or concurrently-created plan, or follow a leaf symlink.
  const file = await open(join(output, 'services.yaml'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.writeFile(documents.map(d => JSON.stringify(d, null, 2)).join('\n---\n') + '\n'); await file.sync(); }
  finally { await file.close(); }
  console.log('Rendered local manifests only. Skew is operator-supplied; endpoint health, cloud placement and model eligibility were not verified. No deployment performed.');
} catch {
  console.error('Cloud manifest rendering refused (' + phase + '). Check explicit inputs and an unused, non-symlinked output location. No deployment performed.');
  process.exitCode = 1;
}
