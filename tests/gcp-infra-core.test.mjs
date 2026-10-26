import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderGcpInfrastructure, validateInfrastructureConfig } from '../scripts/gcp-infra-core.mjs';
const sql = await readFile(new URL('../deploy/postgres/init.sql', import.meta.url), 'utf8');
const config = () => ({
  publicOrigin: 'https://releaseguard.example.test', publicIP: '203.0.113.10', podCIDR: '10.44.0.0/16', clockSkewBoundMs: 137,
  images: { postgres: 'example.test/postgres@sha256:' + 'a'.repeat(64), rabbitmq: 'example.test/rabbitmq@sha256:' + 'b'.repeat(64),
    identity: 'example.test/keycloak@sha256:' + 'c'.repeat(64), edge: 'example.test/caddy@sha256:' + 'd'.repeat(64) },
});
const plan = () => renderGcpInfrastructure(config(), sql);
const doc = (result, kind, name) => result.infrastructure.items.find(d => d.kind === kind && d.metadata.name === name);
const container = (result, kind, name) => doc(result, kind, name).spec.template.spec.containers[0];
function freeze(value) { Object.freeze(value); for (const v of Object.values(value)) if (v && typeof v === 'object') freeze(v); return value; }
test('renders fresh plans without mutating or retaining caller data', () => {
  const input = freeze(config()), before = JSON.stringify(input), first = renderGcpInfrastructure(input, sql);
  first.requirements.privateSecrets[0].keys[0] = 'changed';
  first.infrastructure.items[0].metadata.name = 'changed';
  assert.equal(JSON.stringify(input), before);
  assert.equal(plan().infrastructure.items[0].metadata.name, 'releaseguard');
  assert.equal(plan().requirements.privateSecrets[0].keys[0], 'INTERNAL_SECRET');
});
test('preserves all three persistent data claims and their mounts', () => {
  const p = plan();
  assert.deepEqual(p.infrastructure.items.filter(d => d.kind === 'PersistentVolumeClaim').map(d => [d.metadata.name, d.spec.resources.requests.storage]), [['postgres-data','5Gi'],['rabbit-data','2Gi'],['edge-data','1Gi']]);
  for (const [kind, name, claim] of [['StatefulSet','postgres','postgres-data'],['StatefulSet','rabbitmq','rabbit-data'],['Deployment','edge','edge-data']]) {
    assert.ok(doc(p,kind,name).spec.template.spec.volumes.some(v => v.persistentVolumeClaim?.claimName === claim));
    assert.equal(doc(p,kind,name).spec.replicas, 1);
  }
  assert.equal(doc(p,'Deployment','edge').spec.strategy.type, 'Recreate');
});
test('StatefulSet identities have controlling headless Services, not a load-balanced identity', () => {
  const p = plan();
  for (const name of ['postgres','rabbitmq']) {
    assert.equal(doc(p,'StatefulSet',name).spec.serviceName,name);
    assert.equal(doc(p,'Service',name).spec.clusterIP,'None');
  }
});
test('database bootstrap keeps existing least-privilege SQL and adds identity once outside initdb SQL glob', () => {
  const p = plan(), data = doc(p,'ConfigMap','postgres-init').data;
  assert.ok(data['bootstrap.sql'].startsWith(sql));
  assert.equal(data['bootstrap.sql'].split('CREATE USER rg_identity').length - 1, 1);
  assert.match(data['bootstrap.sql'], /REVOKE CONNECT ON DATABASE rg_identity FROM PUBLIC/);
  assert.match(data['init.sh'], /-v identity_password="\$IDENTITY_DB_PASSWORD"/);
  assert.match(data['init.sh'], /-f \/bootstrap\/bootstrap.sql/);
  const mounts = container(p,'StatefulSet','postgres').volumeMounts;
  assert.ok(mounts.some(v => v.mountPath === '/bootstrap/bootstrap.sql' && v.subPath === 'bootstrap.sql'));
  assert.equal(mounts.some(v => v.mountPath === '/docker-entrypoint-initdb.d/bootstrap.sql'), false);
});
test('database TLS is mandatory for the explicit pod CIDR and other remote traffic is rejected', () => {
  const p = renderGcpInfrastructure({...config(),podCIDR:'172.20.0.0/20'},sql), db=container(p,'StatefulSet','postgres');
  assert.deepEqual(db.args, ['-c','ssl=on','-c','ssl_cert_file=/tls/server.crt','-c','ssl_key_file=/tls/server.key','-c','hba_file=/config/pg_hba.conf']);
  assert.equal(doc(p,'ConfigMap','postgres-config').data['pg_hba.conf'],'local all all trust\nhostssl all all 172.20.0.0/20 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n');
  const pod=doc(p,'StatefulSet','postgres').spec.template.spec;
  assert.equal(pod.securityContext.runAsUser,70);
  assert.equal(pod.volumes.find(v=>v.name==='tls').secret.defaultMode,0o640);
});
test('broker keeps encrypted ports, bounded queue permissions and non-root cookie-only repair', () => {
  const p=plan(), cfg=doc(p,'ConfigMap','rabbit-config').data['rabbitmq.conf'], pod=doc(p,'StatefulSet','rabbitmq').spec.template.spec;
  for(const line of ['listeners.tcp = none','listeners.ssl.default = 5671','management.ssl.port = 15671','default_permissions.configure = ^releaseguard\\.evaluate$','default_user_tags.administrator = false','default_user_tags.monitoring = true']) assert.ok(cfg.split('\n').includes(line),line);
  assert.equal(pod.securityContext.runAsUser,999);
  assert.equal(pod.initContainers[0].image,config().images.rabbitmq);
  assert.deepEqual(pod.initContainers[0].command,['sh','-ec','if [ -f /var/lib/rabbitmq/.erlang.cookie ]; then chmod 600 /var/lib/rabbitmq/.erlang.cookie; fi']);
  assert.equal(pod.containers[0].readinessProbe.timeoutSeconds,5);
  assert.deepEqual(doc(p,'Service','rabbitmq').spec.ports.map(p=>p.port),[5671,15671]);
});
test('identity keeps TLS database verification, proxy context and private realm reference without defining a user', () => {
  const p=plan(), c=container(p,'Deployment','identity'), e=Object.fromEntries(c.env.filter(v=>v.value!==undefined).map(v=>[v.name,v.value]));
  assert.equal(e.KC_HOSTNAME,'https://releaseguard.example.test/auth');
  assert.equal(e.KC_HTTP_RELATIVE_PATH,'/auth');
  assert.equal(e.KC_PROXY_HEADERS,'xforwarded');
  assert.equal(e.KC_DB_URL,'jdbc:postgresql://postgres:5432/rg_identity?sslmode=verify-full&sslrootcert=/trust/ca.crt');
  assert.deepEqual(c.startupProbe,{httpGet:{path:'/auth/health/ready',port:9000},failureThreshold:60,periodSeconds:5});
  assert.ok(c.volumeMounts.some(v=>v.subPath==='releaseguard-realm.json' && v.readOnly));
  assert.equal(JSON.stringify(p).includes('"users"'),false);
  assert.equal(JSON.stringify(p).includes('xinda'),false);
  assert.ok(p.requirements.privateSecrets.find(s=>s.name==='rg-identity').keys.includes('releaseguard-realm.json'));
});
test('only the edge is public and it routes identity before gateway while blocking admin paths', () => {
  const p=plan(), publicServices=p.infrastructure.items.filter(d=>d.kind==='Service'&&d.spec.type==='LoadBalancer');
  assert.deepEqual(publicServices.map(d=>d.metadata.name),['edge']);
  assert.equal(publicServices[0].spec.loadBalancerIP,'203.0.113.10');
  const caddy=doc(p,'ConfigMap','edge-config').data.Caddyfile;
  assert.match(caddy,/respond @admin 404/);
  assert.match(caddy,/@admin path \/auth\/admin\* \/auth\/realms\/master\*/);
  assert.ok(caddy.indexOf('reverse_proxy identity:8080') < caddy.indexOf('reverse_proxy gateway:8080'));
  assert.deepEqual(publicServices[0].spec.ports.map(v=>v.port),[80,443]);
});
test('ingress policies retain service-level calls and never give DB or broker wildcard application sources', () => {
  const p=plan(), expected = [
    ['gateway',['edge'],[8080]],['identity',['edge'],[8080]],['registry',['gateway','evaluation'],[8080]],
    ['evaluation',['gateway','governance'],[8080]],['governance',['gateway'],[8080]],['support',['worker'],[8080]],
    ['postgres',['registry','evaluation','governance','worker','identity'],[5432]],['rabbitmq',['evaluation','worker'],[5671]],
  ];
  assert.deepEqual(doc(p,'NetworkPolicy','default-deny-ingress').spec,{podSelector:{},policyTypes:['Ingress']});
  for(const [target,from,ports] of expected) {
    const rule=doc(p,'NetworkPolicy','allow-'+target).spec.ingress[0];
    assert.deepEqual(rule.from.map(v=>v.podSelector.matchLabels.app),from);
    assert.deepEqual(rule.ports.map(v=>v.port),ports);
    assert.equal(rule.from.some(v=>v.namespaceSelector),false);
  }
  assert.equal(p.requirements.notVerified.includes('KEDA installation and management access policy'),true);
});
test('provider secret clears stale optional real configuration, without claiming live model state', () => {
  const p=plan();
  assert.deepEqual(doc(p,'Secret','rg-provider').stringData,{MODEL_API_URL:'',MODEL_API_KEY:'',MODEL_ID:'',ALLOW_REAL_MODEL:'false'});
  assert.deepEqual(p.infrastructure.items.filter(d=>d.kind==='Secret').map(d=>d.metadata.name),['rg-provider']);
  assert.equal(p.requirements.planOnly,true);
  assert.equal(p.requirements.declaredProviderMode,'disabled');
  assert.ok(p.requirements.notVerified.includes('live model-disabled state'));
});
test('the six-role renderer receives explicit compatible OIDC, CA, namespace and clock inputs', () => {
  const r=plan().requirements.servicesRendererEnv;
  assert.deepEqual(r,{
    PUBLIC_ORIGIN:'https://releaseguard.example.test',AUTH_ISSUER:'https://releaseguard.example.test/auth/realms/releaseguard',
    OIDC_JWKS_URL:'https://releaseguard.example.test/auth/realms/releaseguard/protocol/openid-connect/certs',
    RG_INTERNAL_CA:'true',RG_TRIAL_SMALL:'true',RG_SKIP_NAMESPACE:'true',SUBMISSION_CLOCK_SKEW_BOUND_MS:'137',
  });
});
test('all infrastructure images are the supplied digest pins and workloads do not mount service account tokens', () => {
  const p=plan(),expected={postgres:config().images.postgres,rabbitmq:config().images.rabbitmq,identity:config().images.identity,edge:config().images.edge};
  for(const d of p.infrastructure.items.filter(d=>['StatefulSet','Deployment'].includes(d.kind))) {
    assert.equal(d.spec.template.spec.automountServiceAccountToken,false);
    assert.equal(d.spec.template.spec.containers[0].image,expected[d.metadata.name]);
  }
  assert.deepEqual(doc(p,'Namespace','releaseguard').metadata,{name:'releaseguard'});
  for(const d of p.infrastructure.items.filter(d=>d.kind!=='Namespace')) assert.equal(d.metadata.namespace,'releaseguard');
});
test('storage class and the inclusive clock limits are explicit, not inferred cloud observations', () => {
  const p=renderGcpInfrastructure({...config(),storageClass:'operator-rwo',clockSkewBoundMs:9999},sql);
  assert.equal(doc(p,'PersistentVolumeClaim','edge-data').spec.storageClassName,'operator-rwo');
  assert.equal(p.requirements.servicesRendererEnv.SUBMISSION_CLOCK_SKEW_BOUND_MS,'9999');
  assert.equal(validateInfrastructureConfig({...config(),clockSkewBoundMs:0}).clockSkewBoundMs,0);
});
const bad=[
  ['missing clock',c=>{delete c.clockSkewBoundMs;}],['over-bound clock',c=>{c.clockSkewBoundMs=10000;}],
  ['fractional clock',c=>{c.clockSkewBoundMs=0.5;}],['negative clock',c=>{c.clockSkewBoundMs=-1;}],
  ['string clock',c=>{c.clockSkewBoundMs='0';}],['implicit provider',c=>{c.MODEL_API_KEY='DO_NOT_PRINT';}],
  ['human identity',c=>{c.human='DO_NOT_PRINT';}],['unknown image',c=>{c.images.provider='DO_NOT_PRINT';}],
  ['tag-only image',c=>{c.images.postgres='postgres:latest';}],['missing image',c=>{delete c.images.edge;}],
  ['image credential',c=>{c.images.edge='secret@registry/image@sha256:'+'d'.repeat(64);}],
  ['image whitespace',c=>{c.images.rabbitmq+='\nDO_NOT_PRINT';}],['http origin',c=>{c.publicOrigin='http://example.test';}],
  ['origin credential',c=>{c.publicOrigin='https://user:DO_NOT_PRINT@example.test';}],['origin path',c=>{c.publicOrigin+=' /auth';}],
  ['origin query',c=>{c.publicOrigin+='?token=DO_NOT_PRINT';}],['origin fragment',c=>{c.publicOrigin+='#DO_NOT_PRINT';}],
  ['origin port',c=>{c.publicOrigin='https://example.test:444';}],['origin loopback',c=>{c.publicOrigin='https://127.0.0.1';}],
  ['origin malformed label',c=>{c.publicOrigin='https://a..b.test';}],['origin edge label',c=>{c.publicOrigin='https://-a.test';}],
  ['private edge IP',c=>{c.publicIP='10.1.2.3';}],['multicast edge IP',c=>{c.publicIP='224.1.2.3';}],
  ['non-string IP',c=>{c.publicIP={DO_NOT_PRINT:'DO_NOT_PRINT'};}],['world pod CIDR',c=>{c.podCIDR='0.0.0.0/0';}],
  ['unaligned pod CIDR',c=>{c.podCIDR='10.44.1.1/16';}],['overbroad private CIDR',c=>{c.podCIDR='172.16.0.0/8';}],
  ['injected CIDR',c=>{c.podCIDR='10.44.0.0/16\nhost all all trust';}],['bad storage',c=>{c.storageClass='../DO_NOT_PRINT';}],
];
for(const [name,mutate] of bad) test('refuses '+name+' without echoing supplied values',()=>{
  const c=config();mutate(c);
  assert.throws(()=>renderGcpInfrastructure(c,sql),e=>e instanceof Error&&e.message==='Invalid offline infrastructure configuration'&&!e.stack.includes('DO_NOT_PRINT'));
});
test('refuses empty or NUL SQL without altering the committed bootstrap',()=>{
  for(const input of ['', '\0', ' '.repeat(65537)]) assert.throws(()=>renderGcpInfrastructure(config(),input),/Invalid offline infrastructure configuration/);
});

