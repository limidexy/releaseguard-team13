import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { privateFixture } from './fixtures/gcp-private-data.mjs';
import { renderGcpPrivateInputs } from '../scripts/gcp-private-core.mjs';
import { renderGcpInfrastructure } from '../scripts/gcp-infra-core.mjs';
const now=Date.parse('2026-10-27T00:00:00Z'),base=privateFixture(),make=()=>structuredClone(base);
const get=(p,name)=>p.secrets.items.find(d=>d.metadata.name===name).stringData;
function reject(input,clock=now){assert.throws(()=>renderGcpPrivateInputs(input,clock),e=>e.message==='Invalid explicit private inputs'&&!e.stack.includes('INSECURE_TEST_ONLY')&&!e.stack.includes('BEGIN PRIVATE'));}
function freeze(x){Object.freeze(x);for(const v of Object.values(x))if(v&&typeof v==='object')freeze(v);return x;}
test('ten original non-provider Secret contracts are complete and cover the actual public planner',async()=>{
 const f=make(),p=renderGcpPrivateInputs(f,now),sql=await readFile(new URL('../deploy/postgres/init.sql',import.meta.url),'utf8');
 const req=renderGcpInfrastructure(f.infrastructure,sql).requirements.privateSecrets;
 assert.deepEqual(p.secrets.items.map(d=>d.metadata.name),['rg-internal','rg-internal-ca','postgres-tls','rabbitmq-tls','rg-registry','rg-evaluation','rg-governance','rg-postgres','rg-broker','rg-identity']);
 for(const s of req)assert.deepEqual(Object.keys(get(p,s.name)).sort(),[...s.keys].sort());
 for(const d of p.secrets.items){assert.equal(d.kind,'Secret');assert.equal(d.metadata.namespace,'releaseguard');assert.equal(d.type,'Opaque');}
 assert.equal(p.metadata.privateSecretCount,10);assert.equal(p.metadata.planOnly,true);
 assert.equal(p.metadata.providerSecretIncluded,false);assert.equal(p.metadata.humanPasswordResetDirectivesIncluded,false);
});
test('preserves TLS material byte for byte after real signature/name/key validation',()=>{
 const f=make(),p=renderGcpPrivateInputs(f,now);
 for(const name of ['postgres','rabbitmq']){
  assert.equal(get(p,name+'-tls')['server.crt'],f.tls[name].certificate);
  assert.equal(get(p,name+'-tls')['server.key'],f.tls[name].key);
  assert.equal(get(p,name+'-tls')['ca.crt'],f.tls.ca);
 }
});
test('private database/broker credentials are URI encoded once and remain linked to their actual bootstrap keys',()=>{
 const f=make(),value='TEST_ONLY_@:/?#%&='+'x'.repeat(32);f.secrets.registry=value;f.secrets.rabbit=value;
 const p=renderGcpPrivateInputs(f,now),db=new URL(get(p,'rg-registry').DATABASE_URL);
 assert.equal(decodeURIComponent(db.password),value);assert.equal(db.username,'rg_registry');assert.equal(db.host,'postgres:5432');
 assert.equal(db.pathname,'/rg_registry');assert.equal(db.searchParams.get('sslmode'),'verify-full');assert.equal(db.searchParams.get('sslrootcert'),'/trust/ca.crt');
 assert.equal(get(p,'rg-postgres').REGISTRY_DB_PASSWORD,value);
 const amqp=new URL(get(p,'rg-broker').AMQP_URL),keda=new URL(get(p,'rg-broker').KEDA_MANAGEMENT_URL);
 assert.equal(decodeURIComponent(amqp.password),value);assert.equal(amqp.host,'rabbitmq:5671');assert.equal(amqp.pathname,'/releaseguard');
 assert.equal(decodeURIComponent(keda.password),value);assert.equal(keda.host,'rabbitmq.releaseguard.svc:15671');assert.equal(keda.protocol,'https:');
 assert.equal(get(p,'rg-broker').RABBITMQ_DEFAULT_PASS,value);assert.equal(get(p,'rg-broker').KEDA_TLS,'enable');
});
test('supplied input is immutable and a changed output does not contaminate a second render',()=>{
 const f=freeze(make()),before=JSON.stringify(f),p=renderGcpPrivateInputs(f,now);
 p.secrets.items[0].stringData.INTERNAL_SECRET='changed';
 assert.equal(JSON.stringify(f),before);assert.equal(get(renderGcpPrivateInputs(make(),now),'rg-internal').INTERNAL_SECRET,base.secrets.internal);
});
test('explicit subject/client roles replace a universal browser owner and never use editable user attributes',()=>{
 const p=renderGcpPrivateInputs(make(),now),realm=JSON.parse(get(p,'rg-identity')['releaseguard-realm.json']),browser=realm.clients.find(c=>c.clientId==='releaseguard-browser');
 assert.equal(realm.registrationAllowed,false);assert.equal(realm.bruteForceProtected,true);assert.equal(realm.accessTokenLifespan,300);
 assert.deepEqual(realm.users.map(u=>u.clientRoles['releaseguard-browser']),[['contributor'],['reviewer']]);
 assert.equal(realm.users.some(u=>u.credentials||u.requiredActions||u.attributes),false);
 assert.equal(browser.protocolMappers.some(m=>m.protocolMapper==='oidc-hardcoded-claim-mapper'&&m.config['claim.name']==='role'),false);
 const mapper=browser.protocolMappers.find(m=>m.config['claim.name']==='role');
 assert.equal(mapper.protocolMapper,'oidc-usermodel-client-role-mapper');assert.equal(mapper.config['usermodel.clientRoleMapping.clientId'],'releaseguard-browser');
 assert.equal(mapper.config.multivalued,'false');assert.equal(mapper.config['jsonType.label'],'String');
 assert.deepEqual(browser.redirectUris,['http://127.0.0.1:8765/callback']);assert.equal(browser.attributes['pkce.code.challenge.method'],'S256');
 assert.equal(browser.publicClient,true);assert.equal(browser.directAccessGrantsEnabled,false);assert.equal(browser.serviceAccountsEnabled,false);
});
test('service accounts keep contributor/viewer roles and accountable explicit human IDs rather than display names',()=>{
 const f=make(),realm=JSON.parse(get(renderGcpPrivateInputs(f,now),'rg-identity')['releaseguard-realm.json']);
 for(const [name,role]of [['ci','contributor'],['viewer','viewer']]){
  const c=realm.clients.find(c=>c.clientId==='rg-'+name),claims=Object.fromEntries(c.protocolMappers.filter(m=>m.protocolMapper==='oidc-hardcoded-claim-mapper').map(m=>[m.config['claim.name'],m.config['claim.value']]));
  assert.equal(claims.principal,f.identity.servicePrincipals[name]);assert.equal(claims.service,'true');assert.equal(claims.role,role);assert.equal(claims.workspace,'synthetic-workspace');
  assert.equal(c.serviceAccountsEnabled,true);assert.equal(c.standardFlowEnabled,false);assert.equal(c.directAccessGrantsEnabled,false);
  assert.equal(c.secret,f.secrets[name]);
 }
});
test('human owner role can only be explicitly assigned to one named subject',()=>{
 const f=make();f.identity.subjects[0].role='owner';const realm=JSON.parse(get(renderGcpPrivateInputs(f,now),'rg-identity')['releaseguard-realm.json']);
 assert.deepEqual(realm.users.map(u=>u.clientRoles['releaseguard-browser']),[['owner'],['reviewer']]);
});
const bad=[
 ['missing secret',f=>{delete f.secrets.internal;}],['short secret',f=>{f.secrets.admin='short';}],
 ['secret newline',f=>{f.secrets.rabbit+='\n';}],['implicit human password',f=>{f.secrets.human='DO_NOT_PRINT';}],
 ['hidden real provider',f=>{f.MODEL_API_KEY='DO_NOT_PRINT';}],['missing TLS',f=>{delete f.tls.postgres;}],
 ['wrong key',f=>{f.tls.postgres.key=f.tls.rabbitmq.key;}],['malformed PEM',f=>{f.tls.ca='DO_NOT_PRINT';}],
 ['trailing certificate',f=>{f.tls.postgres.certificate+=f.tls.ca;}],
 ['CA used as server',f=>{f.tls.postgres.certificate=f.tls.ca;}],
 ['encrypted key header',f=>{f.tls.postgres.key=f.tls.postgres.key.replaceAll('PRIVATE KEY','ENCRYPTED PRIVATE KEY');}],
 ['extra CA key',f=>{f.tls.caKey='DO_NOT_PRINT';}],['unbound service principal',f=>{f.identity.servicePrincipals.ci='unknown';}],
 ['reviewer as contributor principal',f=>{f.identity.servicePrincipals.ci=f.identity.subjects[1].id;}],
 ['duplicate subject ID',f=>{f.identity.subjects[1].id=f.identity.subjects[0].id;}],
 ['duplicate username case',f=>{f.identity.subjects[1].username=f.identity.subjects[0].username.toUpperCase();}],
 ['subject password directive',f=>{f.identity.subjects[0].password='DO_NOT_PRINT';}],
 ['unknown human role',f=>{f.identity.subjects[0].role='admin';}],['empty subjects',f=>{f.identity.subjects=[];}],
 ['oversize subjects',f=>{f.identity.subjects=Array(21).fill(f.identity.subjects[0]);}],
 ['workspace newline',f=>{f.identity.workspace+='\n';}],['reserved service-account username',f=>{f.identity.subjects[0].username='service-account-rg-ci';}],
 ['reserved admin username case',f=>{f.identity.subjects[0].username='RGADMIN';}],
];
for(const[name,mutate]of bad)test('refuses '+name+' without returning or logging private values',()=>{const f=make();mutate(f);reject(f);});
for(const [name,options]of [
 ['expired server',{postgres:{to:'250101000000Z'}}],['not yet valid server',{postgres:{from:'280101000000Z'}}],
 ['wrong DNS names',{postgres:{hosts:['wrong.example.test']}}],['CN-only server',{postgres:{hosts:[]}}],
 ['wildcard-only service aliases',{postgres:{hosts:['postgres','*.releaseguard.svc','*.releaseguard.svc.cluster.local']}}],
 ['client-auth-only certificate',{postgres:{serverAuth:false}}],['server outlives CA',{postgres:{to:'350101000000Z'}}],
 ['CA private key reused by server',{pgUsesCAKey:true}],['same private key for two servers',{sharedLeafKey:true}],
])test('rejects '+name+' using real X509 data',()=>reject(privateFixture(options)));
test('rejects a valid server signed by a different supplied CA',()=>{const f=make();f.tls.ca=privateFixture({caScalar:4}).tls.ca;reject(f);});
test('validation time is explicit and expired/not-yet-valid roots cannot be accepted',()=>{
 for(const clock of [0,NaN,1.5,Date.parse('2020-01-01'),Date.parse('2035-01-01')])reject(make(),clock);
});
test('accepts real RSA X509 source-compatible policy using only public insecure fixture factors',()=>{
 const p=renderGcpPrivateInputs(privateFixture({rsa:true}),now);assert.equal(p.metadata.privateSecretCount,10);
});
test('rejects RSA modulus below the declared minimum even when certificate and private key match',()=>reject(privateFixture({weakRSA:true})));

