import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { validateBootstrapConfiguration,opensslTime,prepareNewMaterial } from '../scripts/gcp-bootstrap-core.mjs';
import { renderGcpPrivateInputs } from '../scripts/gcp-private-core.mjs';
import { bootstrapConfiguration,memoryBoundary,materialFixture,epoch,day } from './fixtures/gcp-bootstrap-data.mjs';
const getRealm=b=>JSON.parse(b.items.find(s=>s.metadata.name==='rg-identity').stringData['releaseguard-realm.json']);
test('complete new-material protocol builds ten original contracts and separate new-subject directives without applying them',async()=>{
 const b=memoryBoundary(),input=bootstrapConfiguration(),before=JSON.stringify(input),r=await prepareNewMaterial(input,b.io);
 assert.equal(r.state,'new_material_prepared_not_applied');assert.equal(r.planOnly,true);assert.equal(r.providerEnabled,false);assert.equal(r.identityServerContacted,false);
 assert.equal(r.existingUserPasswordResetAuthorized,false);assert.equal(r.newEmptyRealmAssertionIsNotProof,true);assert.equal(r.operations.length,10);
 assert.equal(JSON.stringify(input),before);assert.equal(b.commands.length,6);assert.equal(b.terminals.length,1);
 const material=JSON.parse(b.files.get('materials.json')),normal=JSON.parse(b.files.get('secrets-existing-subjects.json')),fresh=JSON.parse(b.files.get('secrets-new-realm-only.json'));
 assert.equal(normal.items.length,10);assert.deepEqual(Object.keys(material.sourceCompatibleSecrets).sort(),['admin','ci','evaluation','governance','human','humanId','identity','internal','oidcAdmin','rabbit','registry','viewer'].sort());
 assert.equal(material.sourceCompatibleSecrets.humanId,material.subjects[0].id);assert.equal(material.sourceCompatibleSecrets.human,material.passwords[material.subjects[0].id]);
 assert.equal(getRealm(normal).users.some(u=>u.credentials||u.requiredActions),false);
 assert.deepEqual(getRealm(fresh).users.map(u=>[u.username,u.clientRoles['releaseguard-browser'],u.credentials[0].temporary,u.requiredActions]),
  [['test-contributor',['contributor'],true,['UPDATE_PASSWORD']],['test-reviewer',['reviewer'],true,['UPDATE_PASSWORD']]]);
 for(const user of getRealm(fresh).users)assert.equal(user.credentials[0].value,material.passwords[user.id]);
 assert.equal(r.requestedCAKeyBits,3072);assert.equal(r.requestedServerKeyBits,2048);
 assert.equal(r.caWindowDays,90);assert.equal(r.serverExpiryBound,'actual CA notAfter');
 assert.ok(r.notVerified.some(s=>s.includes('actual Keycloak')));
});
test('actual command contract requests source-strength RSA, explicit exact SANs and CA-bounded absolute leaf expiry',async()=>{
 const b=memoryBoundary({delayIssuance:true});assert.equal((await prepareNewMaterial(bootstrapConfiguration(),b.io)).state,'new_material_prepared_not_applied');
 assert.deepEqual(b.commands.map(c=>c.args[0]),['version','req','req','ca','req','ca']);
 assert.deepEqual(b.commands[1].args,['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-keyout','ca.key','-out','ca.crt','-days','90','-subj','/CN=ReleaseGuard Trial Internal CA',
  '-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
 for(const[name,n]of [['postgres',2],['rabbitmq',4]]){
  assert.deepEqual(b.commands[n].args,['req','-newkey','rsa:2048','-nodes','-sha256','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+name]);
  assert.deepEqual(b.commands[n+1].args,['ca','-batch','-config','ca.cnf','-in',name+'.csr','-out',name+'.crt','-startdate','20261027120002Z','-enddate','20270125120000Z','-notext','-md','sha256','-extensions','server','-extfile',name+'.ext']);
  assert.match(b.files.get(name+'.ext'),new RegExp('subjectAltName=DNS:'+name+',DNS:'+name+'\\.releaseguard\\.svc,DNS:'+name+'\\.releaseguard\\.svc\\.cluster\\.local'));
  const leaf=new X509Certificate(b.files.get(name+'.crt')),root=new X509Certificate(b.files.get('ca.crt'));
  assert.equal(Date.parse(leaf.validTo),Date.parse(root.validTo));assert.equal(Date.parse(leaf.validTo)-Date.parse(leaf.validFrom),90*day-2000);
 }
});
test('independent ninety-day leaf issuance after CA creation is genuinely rejected, not hidden by clock adjustment',()=>{
 const f=materialFixture(epoch,epoch+2000,epoch+90*day+2000);
 assert.throws(()=>renderGcpPrivateInputs(f,epoch+2000),/Invalid explicit private inputs/);
});
test('CA private key mismatch stops before server issuance even if a self-signed CA certificate parses',async()=>{
 const b=memoryBoundary({mismatchedCAKey:true}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
 assert.equal(r.state,'failed_or_unknown_retained');assert.equal(b.commands.length,2);assert.equal(b.files.has('private-input.json'),false);
});
test('repeated random output is rejected rather than binding different new accounts to the same secret',async()=>{
 const b=memoryBoundary({duplicateSecrets:true}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
 assert.equal(r.state,'failed_or_unknown_retained');assert.equal(b.commands.length,1);assert.equal(b.files.has('materials.json'),false);
});
test('unknown terminal persistence is never followed by a second terminal write',async()=>{
 const b=memoryBoundary({fail:['terminal',0]}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
 assert.equal(r.evidenceState,'terminal_persistence_unknown');assert.equal(b.terminals.length,1);
});
test('abort during final inventory cannot return a successful preparation receipt',async()=>{
 const b=memoryBoundary({abortAtInventory:true}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
 assert.equal(r.state,'failed_or_unknown_retained');assert.equal(r.phase,'final-evidence');assert.equal(b.terminals.length,1);
});
test('newly owned partial reservation is recorded as retained failure, never as a pre-reservation refusal',async()=>{
 const b=memoryBoundary();b.io.reserve=async()=>{b.io.reservationOwned=true;throw Error('unknown started durability');};
 const r=await prepareNewMaterial(bootstrapConfiguration(),b.io);assert.equal(r.state,'failed_or_unknown_retained');assert.equal(r.phase,'reservation');assert.equal(b.terminals.length,1);assert.equal(b.commands.length,0);
});
test('unsupported OpenSSL family stops before any password, subject or CA generation',async()=>{
 const b=memoryBoundary({version:'LibreSSL 3.3.6'}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
 assert.equal(r.state,'failed_or_unknown_retained');assert.equal(b.commands.length,1);assert.equal(b.events.some(e=>e[0]==='secret'||e[0]==='id'),false);
});
test('nonzero external command is retained and never retried or followed by a new command',async()=>{
 const b=memoryBoundary({badCommand:3}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
 assert.equal(r.state,'failed_or_unknown_retained');assert.equal(b.commands.length,3);assert.equal(r.phase,'request-postgres');
 assert.ok(b.events.some(e=>e[0]==='observed'&&e[2]===1));assert.equal(b.files.has('private-input.json'),false);
});
for(const fault of [['intent',2],['intent',3],['result',2],['result',3],['observed',2],['write','materials.json'],['write','ca.cnf'],['write','private-input.json'],['inventory',0]])
 test('persistence failure halts without retry: '+fault.join('/'),async()=>{
  const b=memoryBoundary({fail:fault}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
  assert.equal(r.state,'failed_or_unknown_retained');assert.equal(r.retryAllowed,false);assert.equal(r.resumeAllowed,false);
  assert.equal(b.terminals.length,1);assert.equal(JSON.stringify(r).includes('PRIVATE_FAILURE_DO_NOT_PRINT'),false);
  if(fault[1]===2)assert.equal(b.commands.length,fault[0]==='intent'?0:1);
 });
test('abort after persisted intent prevents the associated side effect',async()=>{
 const b=memoryBoundary({abortAtIntent:3}),r=await prepareNewMaterial(bootstrapConfiguration(),b.io);
 assert.equal(r.state,'failed_or_unknown_retained');assert.equal(b.events.some(e=>e[0]==='secret'),false);assert.equal(b.commands.length,1);
});
test('each side effect has a preceding persistent intent; success result follows command observation',async()=>{
 const b=memoryBoundary();await prepareNewMaterial(bootstrapConfiguration(),b.io);let intent=0;
 for(const e of b.events){if(e[0]==='intent')intent=e[1];if(['secret','id','serial','command','write','mkdir'].includes(e[0]))assert.ok(intent>0);}
 for(const[n,name]of [[2,'openssl-version'],[5,'issue-ca'],[6,'request-postgres'],[7,'issue-postgres'],[8,'request-rabbitmq'],[9,'issue-rabbitmq']]){
  const find=kind=>b.events.findIndex(e=>e[0]===kind&&e[1]===n);assert.ok(find('intent')<find('observed'));assert.ok(find('observed')<find('result'));assert.ok(b.events.some(e=>e[0]==='result'&&e[1]===n&&e[2]===name));
 }
});
const invalid=[
 ['implicit original human owner',c=>{c.identity.subjects[0]={username:'rgadmin',role:'owner'};}],
 ['duplicate usernames',c=>{c.identity.subjects[1].username=c.identity.subjects[0].username.toUpperCase();}],
 ['missing primary subject',c=>{delete c.identity.primarySubject;}],['unbound CI principal',c=>{c.identity.servicePrincipals.ci='unknown';}],
 ['reviewer CI binding',c=>{c.identity.servicePrincipals.ci='test-reviewer';}],['arbitrary executable',c=>{c.opensslExecutable='/tmp/openssl';}],
 ['implicit existing realm',c=>{c.mode='existing-realm';}],['provider configuration',c=>{c.MODEL_API_KEY='DO_NOT_PRINT';}],
 ['subject credential override',c=>{c.identity.subjects[0].password='DO_NOT_PRINT';}],['empty subjects',c=>{c.identity.subjects=[];}],
];
for(const[name,change]of invalid)test('configuration refuses '+name+' before reservation or generation',async()=>{
 const c=bootstrapConfiguration();change(c);const b=memoryBoundary(),r=await prepareNewMaterial(c,b.io);assert.equal(r.state,'refused_before_reservation');assert.deepEqual(b.events,[]);
});
test('only explicit owner assignment is retained, and validation returns a defensive copy',()=>{
 const c=bootstrapConfiguration();c.identity.subjects[0].role='owner';const v=validateBootstrapConfiguration(c);v.identity.subjects[0].username='changed';assert.equal(c.identity.subjects[0].username,'test-contributor');
});
test('absolute OpenSSL time conversion uses supplied real UTC instant and refuses invalid clocks',()=>{
 assert.equal(opensslTime(epoch),'20261027120000Z');for(const v of [0,NaN,Infinity,1.5,-1])assert.throws(()=>opensslTime(v));
});
