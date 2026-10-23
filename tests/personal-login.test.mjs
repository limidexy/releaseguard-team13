import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyPersonalJwt,verifyActor,startPersonalLogin,ORIGIN,CLIENT,REDIRECT} from '../scripts/personal-login.mjs';
import {browserRoleMapper,personalBrowserRoleDefinitions} from '../scripts/gcp-browser-identity.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256'};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=p=>{const h=enc({alg:'RS256',kid:'fixture'}),b=enc(p);return h+'.'+b+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+b),privateKey).toString('base64url');};
const claims={iss:ORIGIN+'/auth/realms/releaseguard',aud:'releaseguard',sub:'personal-fixture',exp:2000,role:'reviewer',service:false,workspace:'team13-cloud'};
const options={issuer:claims.iss,audience:'releaseguard',now:1000};
test('personal helper pins public origin, client and registered loopback',()=>{assert.equal(CLIENT,'releaseguard-browser');assert.equal(REDIRECT,'http://127.0.0.1:8765/callback');assert.equal(new URL(ORIGIN).protocol,'https:');});
test('signed fixture accepted without changing claims',()=>assert.deepEqual(verifyPersonalJwt(jwt(claims),[key],options),claims));
for(const [name,value] of [['iss','https://wrong.invalid'],['aud','other'],['exp',999],['nbf',1100],['sub','']])test('rejects invalid '+name,()=>assert.throws(()=>verifyPersonalJwt(jwt({...claims,[name]:value}),[key],options)));
test('rejects bad signature',()=>{const token=jwt(claims);assert.throws(()=>verifyPersonalJwt(token.slice(0,-10)+'aaaaaaaaaa',[key],options));});
test('rejects wrong nonce',()=>assert.throws(()=>verifyPersonalJwt(jwt({...claims,nonce:'other'}),[key],{...options,nonce:'frozen'})));
test('only own personal reviewer can use reviewer entry',()=>assert.deepEqual(verifyActor(claims,{sub:claims.sub,preferred_username:'liaocan'},'liaocan'),{username:'liaocan',role:'reviewer',workspace:'team13-cloud',personal:true}));
for(const altered of [{role:'owner'},{service:true},{workspace:'other'},{sub:'different'}])test('rejects wrong actor '+JSON.stringify(altered),()=>assert.throws(()=>verifyActor({...claims,...altered},{sub:claims.sub,preferred_username:'liaocan'},'liaocan')));
test('rejects someone else username',()=>assert.throws(()=>verifyActor(claims,{sub:claims.sub,preferred_username:'xinda'},'liaocan')));
test('bootstrap uses per-user mapper and no owner client role',()=>{const m=browserRoleMapper();assert.equal(m.protocolMapper,'oidc-usermodel-client-role-mapper');assert.equal(m.config['usermodel.clientRoleMapping.clientId'],CLIENT);assert.equal(m.config.multivalued,'false');assert(!personalBrowserRoleDefinitions().some(r=>r.name==='owner'));});
test('helper rejects malformed username before network',async()=>{let n=0;await assert.rejects(startPersonalLogin('<script>',{fetchImpl:()=>{n++;}}));assert.equal(n,0);});
test('helper rejects metadata from another provider',async()=>{await assert.rejects(startPersonalLogin('liaocan',{fetchImpl:async()=>({ok:true,json:async()=>({issuer:'https://evil.invalid'})})}));});
test('complete PKCE fixture uses own browser session and read-only workspace calls',async()=>{
 let nonce,exchanged=false,callbackResult;const requests=[];
 const fetcher=async(url,opts={})=>{
  url=String(url);requests.push({url,method:opts.method??'GET'});
  if(url.endsWith('/.well-known/openid-configuration'))return Response.json({issuer:claims.iss,authorization_endpoint:claims.iss+'/protocol/openid-connect/auth',token_endpoint:claims.iss+'/protocol/openid-connect/token',jwks_uri:claims.iss+'/protocol/openid-connect/certs'});
  if(url.endsWith('/certs'))return Response.json({keys:[key]});
  if(url.endsWith('/token')){assert.equal(opts.body.get('grant_type'),'authorization_code');assert.equal(opts.body.get('redirect_uri'),REDIRECT);assert(opts.body.get('code_verifier').length>40);exchanged=true;const live={...claims,exp:Math.floor(Date.now()/1000)+180};return Response.json({access_token:jwt(live),id_token:jwt({...live,aud:CLIENT,preferred_username:'liaocan',nonce})});}
  if(url.startsWith(ORIGIN+'/api/v2/')){assert.equal(opts.method,undefined);return Response.json([]);}
  throw Error('Unexpected fixture request');
 };
 const server=await startPersonalLogin('liaocan',{fetchImpl:fetcher,onVerified:r=>callbackResult=r});
 try{
  const first=await fetch('http://127.0.0.1:8765/start',{redirect:'manual'});assert.equal(first.status,302);const u=new URL(first.headers.get('location'));nonce=u.searchParams.get('nonce');assert.equal(u.searchParams.get('login_hint'),'liaocan');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  const bad=await fetch('http://127.0.0.1:8765/callback?state=wrong&code=fixture');assert.equal(bad.status,400);assert.equal(exchanged,false);
  const result=await fetch('http://127.0.0.1:8765/callback?'+new URLSearchParams({state:u.searchParams.get('state'),code:'fixture'}));assert.equal(result.status,200);assert((await result.text()).includes('liaocan / reviewer'));assert.equal(callbackResult.personal,true);assert.equal(callbackResult.checks.length,2);
  const repeated=await fetch('http://127.0.0.1:8765/callback?'+new URLSearchParams({state:u.searchParams.get('state'),code:'fixture'}));assert.equal(repeated.status,400);assert.equal(requests.filter(r=>r.url.endsWith('/token')).length,1);assert.equal(requests.filter(r=>r.url.includes('/api/v2/')).length,2);assert(!requests.some(r=>r.url.includes('groq')||r.url.includes('/review')));
 }finally{await new Promise(r=>server.close(r));}
});
