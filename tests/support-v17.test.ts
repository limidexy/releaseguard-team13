import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {SignJWT} from 'jose';

process.env.SERVICE_ROLE='support';process.env.AUTH_MODE='dev';process.env.ALLOW_DEV_AUTH='true';
process.env.AUTH_SECRET='unit-test-only-auth-key-not-for-deployment';process.env.INTERNAL_SECRET='unit-test-only-internal-key-not-for-deployment';
const {support}=await import('../src/support.js');
const bearer=await new SignJWT({caller:'worker'}).setProtectedHeader({alg:'HS256'}).setIssuer('releaseguard-services').setAudience('support').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.INTERNAL_SECRET));
const headers={authorization:'Bearer '+bearer};
const input={source:'replay',promptVersion:'v17',scenario:'passing',cases:[{id:'damaged',name:'Damage',prompt:'My item arrived damaged. What should I do?',rule:'returns_policy_v2_10',expected:'damaged',critical:true}]};
test('support accepts v17 replay but labels it synthetic',async()=>{const app=Fastify();await support(app);try{const res=await app.inject({method:'POST',url:'/execute',headers,payload:input});assert.equal(res.statusCode,200);assert.equal(res.json().provenance.source,'replay');assert.equal(res.json().provenance.promptVersion,'v17');assert.equal(res.json().provenance.trust,'labelled_static_fixture');}finally{await app.close();}});
test('v17 real provider remains disabled without explicit configuration',async()=>{const app=Fastify();await support(app);try{process.env.ALLOW_REAL_MODEL='false';const res=await app.inject({method:'POST',url:'/execute',headers,payload:{...input,source:'real'}});assert.equal(res.statusCode,503);}finally{await app.close();}});
