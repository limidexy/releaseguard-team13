import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('import and pure plan construction cannot enter blocked native, provider or network boundaries',()=>{
 const moduleURL=new URL('../scripts/deploy-object-core.mjs',import.meta.url).href;
 const code=`
 import cp from 'node:child_process';import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import {syncBuiltinESMExports} from 'node:module';
 let entered=0;const blocked=()=>{entered++;throw Error('Synthetic forbidden IO boundary');};
 for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=blocked;
 for(const x of [http,https])for(const k of ['request','get','createServer'])x[k]=blocked;
 for(const k of ['connect','createConnection','createServer'])net[k]=blocked;for(const k of ['connect','createServer'])tls[k]=blocked;globalThis.fetch=blocked;syncBuiltinESMExports();
 const m=await import(${JSON.stringify(moduleURL)}),r=m.deploymentObjectRef('ConfigMap','rg-config');
 const s=m.captureDeploymentObject(r,{apiVersion:'v1',kind:'ConfigMap',metadata:{name:'rg-config',namespace:'releaseguard',uid:'synthetic-uid',resourceVersion:'opaque:1',managedFields:[]},data:{SYNTHETIC:'before'}});
 const p=m.planDeploymentClaim(s,'81111111-1111-4111-8111-111111111111');if(!p||entered)throw Error('Unexpected IO or missing plan');console.log(JSON.stringify({entered,operation:p.operation}));
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.deepEqual(JSON.parse(result.stdout),{entered:0,operation:'claim'});
});
