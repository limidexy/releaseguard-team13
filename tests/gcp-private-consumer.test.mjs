// This is a synthetic declared-claim projection into the actual application schema,
// NOT Keycloak token minting, signature verification, login or live user acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { privateFixture } from './fixtures/gcp-private-data.mjs';
import { renderGcpPrivateInputs } from '../scripts/gcp-private-core.mjs';
net.Socket.prototype.connect=()=>{throw Error('No TCP in private claim-contract tests');};
globalThis.fetch=()=>{throw Error('No fetch in private claim-contract tests');};
Object.assign(process.env,{AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:'INSECURE_TEST_ONLY_AUTH_'+ 'x'.repeat(32),DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked',INTERNAL_SECRET:'INSECURE_TEST_ONLY_INTERNAL_'+ 'x'.repeat(32)});
const common=await import('../dist/src/common.js');
const f=privateFixture(),p=renderGcpPrivateInputs(f,Date.parse('2026-10-27'));
const realm=JSON.parse(p.secrets.items.find(d=>d.metadata.name==='rg-identity').stringData['releaseguard-realm.json']);
function declared(clientId,subject){
 const client=realm.clients.find(c=>c.clientId===clientId),raw={sub:subject.id};
 for(const m of client.protocolMappers){
  if(m.protocolMapper==='oidc-hardcoded-claim-mapper')raw[m.config['claim.name']]=m.config['jsonType.label']==='boolean'?m.config['claim.value']==='true':m.config['claim.value'];
  else if(m.protocolMapper==='oidc-usermodel-client-role-mapper'){
   const roles=subject.clientRoles?.[m.config['usermodel.clientRoleMapping.clientId']];
   if(roles?.length===1)raw[m.config['claim.name']]=roles[0];
  }
 }
 return common.actorSchema.parse(raw);
}
test('declared service identities satisfy the actual schema and are never human reviewers',()=>{
 const c=declared('rg-ci',{id:'synthetic-service-ci'}),v=declared('rg-viewer',{id:'synthetic-service-viewer'});
 assert.equal(common.accountable(c),f.identity.subjects[0].id);assert.equal(common.accountable(v),f.identity.subjects[1].id);
 assert.equal(c.role,'contributor');assert.equal(v.role,'viewer');assert.equal(c.service,true);
 assert.doesNotThrow(()=>common.write(c));assert.throws(()=>common.write(v),e=>e.statusCode===403);
 assert.throws(()=>common.review(c),e=>e.statusCode===403);assert.throws(()=>common.review(v),e=>e.statusCode===403);
});
test('declared browser subjects keep separate actual write/review permissions and accountable subject IDs',()=>{
 const c=declared('releaseguard-browser',realm.users[0]),r=declared('releaseguard-browser',realm.users[1]);
 assert.equal(c.service,false);assert.equal(common.accountable(c),f.identity.subjects[0].id);
 assert.equal(common.accountable(c),common.accountable(declared('rg-ci',{id:'synthetic-ci-sub'})));
 assert.doesNotThrow(()=>common.write(c));assert.throws(()=>common.review(c),e=>e.statusCode===403);
 assert.doesNotThrow(()=>common.review(r));assert.throws(()=>common.write(r),e=>e.statusCode===403);
});
test('a browser subject without the explicit approved client role fails the actual actor schema',()=>{
 assert.throws(()=>declared('releaseguard-browser',{id:'not-bound',clientRoles:{}}));
});
await common.pool.end();

