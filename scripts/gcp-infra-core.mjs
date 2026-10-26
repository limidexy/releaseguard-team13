// Pure, non-secret infrastructure plan. This module never reads files or credentials,
// generates keys, creates identities, contacts providers or applies Kubernetes objects.
import { isIP } from 'node:net';

const namespace = 'releaseguard';
const imageKeys = ['postgres', 'rabbitmq', 'identity', 'edge'];
const privateRequirements = [
  ['rg-internal', ['INTERNAL_SECRET']],
  ['rg-internal-ca', ['ca.crt']],
  ['postgres-tls', ['server.crt', 'server.key', 'ca.crt']],
  ['rabbitmq-tls', ['server.crt', 'server.key', 'ca.crt']],
  ...['registry', 'evaluation', 'governance'].map(role => ['rg-' + role, ['DATABASE_URL']]),
  ['rg-postgres', ['POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'EVALUATION_DB_PASSWORD', 'GOVERNANCE_DB_PASSWORD', 'IDENTITY_DB_PASSWORD']],
  ['rg-broker', ['AMQP_URL', 'KEDA_MANAGEMENT_URL', 'KEDA_TLS', 'RABBITMQ_DEFAULT_PASS']],
  ['rg-identity', ['KC_DB_PASSWORD', 'KC_BOOTSTRAP_ADMIN_USERNAME', 'KC_BOOTSTRAP_ADMIN_PASSWORD', 'releaseguard-realm.json']],
];
function invalid() { throw Error('Invalid offline infrastructure configuration'); }
function object(value, allowed, required = allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
}
function cidr(value) {
  if (typeof value !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}\/(?:[89]|[12]\d|30)$/.test(value)) invalid();
  const [ip, prefixText] = value.split('/'), prefix = Number(prefixText);
  if (isIP(ip) !== 4 || ip.split('.').some(n => String(Number(n)) !== n)) invalid();
  const octets = ip.split('.').map(Number), number = octets.reduce((a, n) => a * 256 + n, 0);
  const privateIP = octets[0] === 10 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168;
  const privatePrefix = octets[0] === 10 ? 8 : octets[0] === 172 ? 12 : 16;
  if (!privateIP || prefix < privatePrefix || number % (2 ** (32 - prefix)) !== 0) invalid();
  return value;
}
export function validateInfrastructureConfig(input) {
  object(input, ['publicOrigin', 'publicIP', 'podCIDR', 'clockSkewBoundMs', 'images', 'storageClass'], ['publicOrigin', 'publicIP', 'podCIDR', 'clockSkewBoundMs', 'images']);
  const { publicOrigin, publicIP, podCIDR, clockSkewBoundMs } = input;
  if (typeof publicOrigin !== 'string' || /[\x00-\x20\x7f]/.test(publicOrigin)) invalid();
  let origin;
  try {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        url.port || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
        isIP(url.hostname) || url.hostname.length > 253 || !url.hostname.includes('.') ||
        url.hostname.split('.').some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) invalid();
    origin = url.origin;
    if (publicOrigin !== origin && publicOrigin !== origin + '/') invalid();
  } catch { invalid(); }
  if (typeof publicIP !== 'string' || isIP(publicIP) !== 4) invalid();
  const ipParts = publicIP.split('.').map(Number);
  if (ipParts[0] === 0 || ipParts[0] === 10 || ipParts[0] === 127 || ipParts[0] >= 224 ||
      ipParts[0] === 169 && ipParts[1] === 254 || ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31 ||
      ipParts[0] === 192 && ipParts[1] === 168) invalid();
  if (!Number.isSafeInteger(clockSkewBoundMs) || clockSkewBoundMs < 0 || clockSkewBoundMs >= 10000) invalid();
  object(input.images, imageKeys);
  const images = Object.fromEntries(imageKeys.map(key => {
    const value = input.images[key];
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(value) || value.includes('..') || value.includes('://')) invalid();
    return [key, value];
  }));
  const storageClass = input.storageClass ?? 'standard-rwo';
  if (typeof storageClass !== 'string' || storageClass.length > 63 || !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(storageClass)) invalid();
  return { publicOrigin: origin, publicIP, podCIDR: cidr(podCIDR), clockSkewBoundMs, images, storageClass };
}

export function renderGcpInfrastructure(input, bootstrapSql) {
  const config = validateInfrastructureConfig(input);
  if (typeof bootstrapSql !== 'string' || !bootstrapSql.trim() || Buffer.byteLength(bootstrapSql) > 65536 || bootstrapSql.includes('\0')) invalid();
  const origin = config.publicOrigin, docs = [];
  const meta = name => ({ name, namespace });
  const add = (kind, name, body, apiVersion = 'v1') => {
    const doc = { apiVersion, kind, metadata: meta(name), ...body }; docs.push(doc); return doc;
  };
  const env = (name, value) => ({ name, value });
  const secretEnv = (name, secret, key = name) => ({ name, valueFrom: { secretKeyRef: { name: secret, key } } });
  const cm = (name, data) => add('ConfigMap', name, { data });
  const service = (name, ports) => add('Service', name, { spec: { selector: { app: name }, ports: ports.map(port => ({ name: 'p' + port, port, targetPort: port })), type: 'ClusterIP', ...(['postgres', 'rabbitmq'].includes(name) ? { clusterIP: 'None' } : {}) } });
  const pvc = (name, size) => add('PersistentVolumeClaim', name, { spec: { accessModes: ['ReadWriteOnce'], storageClassName: config.storageClass, resources: { requests: { storage: size } } } });
  const restricted = { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } };
  const stateful = (name, container, volumes, securityContext) => add('StatefulSet', name, { spec: {
    serviceName: name, replicas: 1, selector: { matchLabels: { app: name } },
    template: { metadata: { labels: { app: name } }, spec: { automountServiceAccountToken: false, securityContext, containers: [container], volumes } },
  } }, 'apps/v1');
  add('Namespace', namespace, {}); delete docs[0].metadata.namespace;
  const identitySql = "\nCREATE USER rg_identity WITH PASSWORD :'identity_password';\nCREATE DATABASE rg_identity OWNER rg_identity;\nREVOKE CONNECT ON DATABASE rg_identity FROM PUBLIC;\nGRANT CONNECT ON DATABASE rg_identity TO rg_identity;\n";
  cm('postgres-init', {
    'bootstrap.sql': bootstrapSql + identitySql,
    'init.sh': '#!/bin/sh\nset -eu\npsql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v registry_password="$REGISTRY_DB_PASSWORD" -v evaluation_password="$EVALUATION_DB_PASSWORD" -v governance_password="$GOVERNANCE_DB_PASSWORD" -v identity_password="$IDENTITY_DB_PASSWORD" -f /bootstrap/bootstrap.sql\n',
  });
  cm('postgres-config', { 'pg_hba.conf': 'local all all trust\nhostssl all all ' + config.podCIDR + ' scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n' });
  pvc('postgres-data', '5Gi'); service('postgres', [5432]);
  stateful('postgres', {
    name: 'postgres', image: config.images.postgres,
    args: ['-c', 'ssl=on', '-c', 'ssl_cert_file=/tls/server.crt', '-c', 'ssl_key_file=/tls/server.key', '-c', 'hba_file=/config/pg_hba.conf'],
    env: [env('POSTGRES_USER', 'rg_admin'), env('POSTGRES_DB', 'postgres'), env('PGDATA', '/var/lib/postgresql/data/pgdata'),
      ...['POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'EVALUATION_DB_PASSWORD', 'GOVERNANCE_DB_PASSWORD', 'IDENTITY_DB_PASSWORD'].map(key => secretEnv(key, 'rg-postgres'))],
    resources: { requests: { cpu: '150m', memory: '256Mi' }, limits: { cpu: '1000m', memory: '768Mi' } },
    volumeMounts: [{ name: 'data', mountPath: '/var/lib/postgresql/data' }, { name: 'init', mountPath: '/docker-entrypoint-initdb.d/init.sh', subPath: 'init.sh' },
      { name: 'init', mountPath: '/bootstrap/bootstrap.sql', subPath: 'bootstrap.sql' }, { name: 'config', mountPath: '/config' }, { name: 'tls', mountPath: '/tls', readOnly: true }],
    readinessProbe: { exec: { command: ['pg_isready', '-U', 'rg_admin', '-d', 'postgres'] }, periodSeconds: 5 }, securityContext: structuredClone(restricted),
  }, [{ name: 'data', persistentVolumeClaim: { claimName: 'postgres-data' } }, { name: 'init', configMap: { name: 'postgres-init', defaultMode: 0o555 } },
    { name: 'config', configMap: { name: 'postgres-config' } }, { name: 'tls', secret: { secretName: 'postgres-tls', defaultMode: 0o640 } }],
  { runAsUser: 70, runAsGroup: 70, fsGroup: 70, runAsNonRoot: true });
  cm('rabbit-config', { 'rabbitmq.conf': [
    'listeners.tcp = none', 'listeners.ssl.default = 5671', 'ssl_options.cacertfile = /tls/ca.crt',
    'ssl_options.certfile = /tls/server.crt', 'ssl_options.keyfile = /tls/server.key',
    'ssl_options.verify = verify_none', 'ssl_options.fail_if_no_peer_cert = false',
    'management.ssl.port = 15671', 'management.ssl.cacertfile = /tls/ca.crt',
    'management.ssl.certfile = /tls/server.crt', 'management.ssl.keyfile = /tls/server.key',
    'default_vhost = releaseguard', 'default_permissions.configure = ^releaseguard\\.evaluate$',
    'default_permissions.write = ^(releaseguard\\.evaluate|amq\\.default)$', 'default_permissions.read = ^releaseguard\\.evaluate$',
    'default_user_tags.administrator = false', 'default_user_tags.monitoring = true', '',
  ].join('\n') });
  pvc('rabbit-data', '2Gi'); service('rabbitmq', [5671, 15671]);
  const rabbit = stateful('rabbitmq', {
    name: 'rabbitmq', image: config.images.rabbitmq,
    env: [env('RABBITMQ_DEFAULT_USER', 'rg'), secretEnv('RABBITMQ_DEFAULT_PASS', 'rg-broker'), env('RABBITMQ_NODENAME', 'rabbit@rabbitmq-0')],
    resources: { requests: { cpu: '150m', memory: '384Mi' }, limits: { cpu: '750m', memory: '768Mi' } },
    volumeMounts: [{ name: 'data', mountPath: '/var/lib/rabbitmq' }, { name: 'config', mountPath: '/etc/rabbitmq/rabbitmq.conf', subPath: 'rabbitmq.conf' }, { name: 'tls', mountPath: '/tls', readOnly: true }],
    readinessProbe: { exec: { command: ['rabbitmq-diagnostics', '-q', 'ping'] }, periodSeconds: 10, timeoutSeconds: 5 }, securityContext: structuredClone(restricted),
  }, [{ name: 'data', persistentVolumeClaim: { claimName: 'rabbit-data' } }, { name: 'config', configMap: { name: 'rabbit-config' } },
    { name: 'tls', secret: { secretName: 'rabbitmq-tls', defaultMode: 0o640 } }],
  { runAsUser: 999, runAsGroup: 999, fsGroup: 999, runAsNonRoot: true });
  rabbit.spec.template.spec.initContainers = [{
    name: 'cookie-permissions', image: config.images.rabbitmq,
    command: ['sh', '-ec', 'if [ -f /var/lib/rabbitmq/.erlang.cookie ]; then chmod 600 /var/lib/rabbitmq/.erlang.cookie; fi'],
    volumeMounts: [{ name: 'data', mountPath: '/var/lib/rabbitmq' }], securityContext: structuredClone(restricted),
  }];
  service('identity', [8080, 9000]);
  add('Deployment', 'identity', { spec: { replicas: 1, selector: { matchLabels: { app: 'identity' } }, template: {
    metadata: { labels: { app: 'identity' } }, spec: {
      automountServiceAccountToken: false, securityContext: { runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, runAsNonRoot: true },
      containers: [{
        name: 'identity', image: config.images.identity, args: ['start', '--import-realm'],
        env: [env('KC_DB', 'postgres'), env('KC_DB_URL', 'jdbc:postgresql://postgres:5432/rg_identity?sslmode=verify-full&sslrootcert=/trust/ca.crt'), env('KC_DB_USERNAME', 'rg_identity'),
          secretEnv('KC_DB_PASSWORD', 'rg-identity'), secretEnv('KC_BOOTSTRAP_ADMIN_USERNAME', 'rg-identity'), secretEnv('KC_BOOTSTRAP_ADMIN_PASSWORD', 'rg-identity'),
          env('KC_HOSTNAME', origin + '/auth'), env('KC_HTTP_RELATIVE_PATH', '/auth'), env('KC_HTTP_ENABLED', 'true'), env('KC_PROXY_HEADERS', 'xforwarded'),
          env('KC_HEALTH_ENABLED', 'true'), env('KC_CACHE', 'local'), env('JAVA_OPTS_KC_HEAP', '-Xms256m -Xmx512m')],
        resources: { requests: { cpu: '250m', memory: '640Mi' }, limits: { cpu: '1000m', memory: '1024Mi' } },
        securityContext: structuredClone(restricted), volumeMounts: [{ name: 'realm', mountPath: '/opt/keycloak/data/import/releaseguard-realm.json', subPath: 'releaseguard-realm.json', readOnly: true }, { name: 'trust', mountPath: '/trust', readOnly: true }],
        startupProbe: { httpGet: { path: '/auth/health/ready', port: 9000 }, failureThreshold: 60, periodSeconds: 5 },
        readinessProbe: { httpGet: { path: '/auth/health/ready', port: 9000 }, periodSeconds: 5 },
      }],
      volumes: [{ name: 'realm', secret: { secretName: 'rg-identity' } }, { name: 'trust', secret: { secretName: 'rg-internal-ca' } }],
    },
  } } }, 'apps/v1');
  cm('edge-config', { Caddyfile: new URL(origin).hostname + ' {\n  encode gzip\n  route {\n    @admin path /auth/admin* /auth/realms/master*\n    respond @admin 404\n    handle /auth/* {\n      reverse_proxy identity:8080\n    }\n    handle {\n      reverse_proxy gateway:8080\n    }\n  }\n}\n' });
  pvc('edge-data', '1Gi');
  add('Deployment', 'edge', { spec: { replicas: 1, strategy: { type: 'Recreate' }, selector: { matchLabels: { app: 'edge' } }, template: {
    metadata: { labels: { app: 'edge' } }, spec: { automountServiceAccountToken: false,
      containers: [{ name: 'edge', image: config.images.edge, ports: [{ containerPort: 80 }, { containerPort: 443 }],
        resources: { requests: { cpu: '100m', memory: '64Mi' }, limits: { cpu: '500m', memory: '256Mi' } },
        securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'], add: ['NET_BIND_SERVICE'] } },
        volumeMounts: [{ name: 'config', mountPath: '/etc/caddy/Caddyfile', subPath: 'Caddyfile' }, { name: 'data', mountPath: '/data' }, { name: 'runtime', mountPath: '/config' }] }],
      volumes: [{ name: 'config', configMap: { name: 'edge-config' } }, { name: 'data', persistentVolumeClaim: { claimName: 'edge-data' } }, { name: 'runtime', emptyDir: {} }],
    },
  } } }, 'apps/v1');
  add('Service', 'edge', { spec: { type: 'LoadBalancer', loadBalancerIP: config.publicIP, selector: { app: 'edge' },
    ports: [{ name: 'http', port: 80, targetPort: 80 }, { name: 'https', port: 443, targetPort: 443 }] } });
  add('NetworkPolicy', 'default-deny-ingress', { spec: { podSelector: {}, policyTypes: ['Ingress'] } }, 'networking.k8s.io/v1');
  for (const [target, sources, ports] of [
    ['gateway', ['edge'], [8080]], ['identity', ['edge'], [8080]], ['registry', ['gateway', 'evaluation'], [8080]],
    ['evaluation', ['gateway', 'governance'], [8080]], ['governance', ['gateway'], [8080]], ['support', ['worker'], [8080]],
    ['postgres', ['registry', 'evaluation', 'governance', 'worker', 'identity'], [5432]], ['rabbitmq', ['evaluation', 'worker'], [5671]],
  ]) add('NetworkPolicy', 'allow-' + target, { spec: { podSelector: { matchLabels: { app: target } }, policyTypes: ['Ingress'],
    ingress: [{ from: sources.map(app => ({ podSelector: { matchLabels: { app } } })), ports: ports.map(port => ({ protocol: 'TCP', port })) }],
  } }, 'networking.k8s.io/v1');
  add('NetworkPolicy', 'allow-edge', { spec: { podSelector: { matchLabels: { app: 'edge' } }, policyTypes: ['Ingress'],
    ingress: [{ ports: [{ protocol: 'TCP', port: 80 }, { protocol: 'TCP', port: 443 }] }],
  } }, 'networking.k8s.io/v1');
  // Fixed empty values prevent an old optional provider Secret from implicitly enabling
  // Support when this plan is intentionally applied later. Rendering is not application.
  add('Secret', 'rg-provider', { type: 'Opaque', stringData: { MODEL_API_URL: '', MODEL_API_KEY: '', MODEL_ID: '', ALLOW_REAL_MODEL: 'false' } });
  return {
    infrastructure: { apiVersion: 'v1', kind: 'List', items: docs },
    requirements: {
      formatVersion: 1, planOnly: true, namespace, declaredProviderMode: 'disabled',
      privateSecrets: privateRequirements.map(([name, keys]) => ({ name, keys: [...keys] })),
      servicesRendererEnv: {
        PUBLIC_ORIGIN: origin, AUTH_ISSUER: origin + '/auth/realms/releaseguard',
        OIDC_JWKS_URL: origin + '/auth/realms/releaseguard/protocol/openid-connect/certs',
        RG_INTERNAL_CA: 'true', RG_TRIAL_SMALL: 'true', RG_SKIP_NAMESPACE: 'true',
        SUBMISSION_CLOCK_SKEW_BOUND_MS: String(config.clockSkewBoundMs),
      },
      notVerified: ['image/version compatibility', 'reserved IP and pod CIDR ownership', 'certificate validity and key ownership',
        'realm and principal provisioning', 'KEDA installation and management access policy', 'storage and node/zone placement',
        'NetworkPolicy enforcement and runtime connectivity', 'live model-disabled state', 'availability or scaling benefit'],
      pendingSourceAdapters: ['explicit private certificate/secret/identity material adapter; no implicit human account or key generation',
        'cloud orchestration and autoscaling configuration; not performed by this renderer'],
    },
  };
}

