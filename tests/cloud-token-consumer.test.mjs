// Actual current auth/permission consumer with synthetic HS256 development JWTs.
// This does NOT test live OIDC RS256/JWKS/Keycloak, mint operational credentials,
// or replace a human review. Every fetch is fake and all native TCP is forbidden.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { SignJWT } from 'jose';
import { cloudToken } from '../scripts/cloud-token.mjs';
net.Socket.prototype.connect=()=>{throw Error('Native network forbidden in token consumer regressions');};
globalThis.fetch=()=>{throw Error('Native fetch forbidden in token consumer regressions');};
const authSecret='INSECURE_TEST_ONLY_LOCAL_HS256_'+ 'x'.repeat(40);
Object.assign(process.env,{AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:authSecret,SERVICE_ROLE:'gateway',DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked',INTERNAL_SECRET:'INSECURE_TEST_ONLY_INTERNAL_'+ 'x'.repeat(40)});
delete process.env.AUTH_ISSUER;
const common=await import('../dist/src/common.js');
const app=common.server();
after(async()=>{await app.close();await common.pool.end();});
app.get('/test/write',async req=>{const a=await common.actor(req);common.write(a);return {role:a.role,service:a.service,accountable:common.accountable(a)};});
app.get('/test/review',async req=>{const a=await common.actor(req);common.review(a);return {allowed:true};});
const request=async(claims,changes={})=>{
 const jwt=await new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuer(changes.issuer??'releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(authSecret));
 const cfg={allowServiceAuthentication:true,targetOrigin:'https://releaseguard.example.test',allowedOrigins:['https://releaseguard.example.test'],issuer:'https://releaseguard.example.test/auth/realms/releaseguard',clientId:'rg-'+(claims.role==='viewer'?'viewer':'ci'),clientSecret:'INSECURE_TEST_ONLY_CLIENT_'+ 'x'.repeat(40),timeoutMs:15000};
 return cloudToken(cfg,{fetch:async()=>new Response(JSON.stringify({access_token:jwt,token_type:'bearer',expires_in:300}),{headers:{'content-type':'application/json'}})});
};
test('returned contributor service token reaches the actual verifier, remains accountable, and cannot approve',async()=>{
 const token=await request({sub:'synthetic-ci',workspace:'synthetic-workspace',role:'contributor',service:true,principal:'synthetic-subject-1'});
 const w=await app.inject({url:'/test/write',headers:{authorization:'Bearer '+token}});assert.equal(w.statusCode,200);assert.deepEqual(w.json(),{role:'contributor',service:true,accountable:'synthetic-subject-1'});
 const r=await app.inject({url:'/test/review',headers:{authorization:'Bearer '+token}});assert.equal(r.statusCode,403);
});
test('returned viewer service token cannot write or review through actual permission guards',async()=>{
 const token=await request({sub:'synthetic-viewer',workspace:'synthetic-workspace',role:'viewer',service:true,principal:'synthetic-subject-2'});
 for(const url of ['/test/write','/test/review'])assert.equal((await app.inject({url,headers:{authorization:'Bearer '+token}})).statusCode,403);
});
test('successful token retrieval does not bypass the actual verifier or accountable-principal schema',async()=>{
 for(const[claims,changes]of [[{sub:'synthetic-ci',workspace:'synthetic-workspace',role:'contributor',service:true},{}],
  [{sub:'synthetic-ci',workspace:'synthetic-workspace',role:'contributor',service:true,principal:'synthetic-subject-1'},{issuer:'wrong-synthetic-issuer'}]]){
  const token=await request(claims,changes);assert.equal((await app.inject({url:'/test/write',headers:{authorization:'Bearer '+token}})).statusCode,401);
 }
});
await app.ready();
