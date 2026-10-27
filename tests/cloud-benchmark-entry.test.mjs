import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {benchmarkHarness} from './fixtures/cloud-benchmark-cli-harness.mjs';
import {token} from './fixtures/cloud-benchmark-protocol.mjs';
const posix={skip:process.platform==='win32'?'Private fsync/operator entry is POSIX-only':false};
test('actual CLI completes full100-job/800-history protocol through native fake API commands, retains private raw receipts and owned restoration',posix,t=>{
 const h=benchmarkHarness(t),r=h.execute();assert.equal(r.status,0,r.stderr);const term=h.json(join(h.run,'terminal.json'));assert.equal(term.passed,true);assert.equal(term.requests,1008);assert.equal(term.restoration.state,'restored');
 assert.equal(h.requests().length,1008);assert.equal(h.commands().some(c=>c.kind==='patch-worker'),true);assert.equal(h.commands().some(c=>c.kind==='patch-controller'),true);
 assert.equal(h.commands().some(c=>c.args.some(a=>['apply','exec','delete','resize','get-credentials'].includes(a))),false);
 assert.equal(fs.statSync(h.run).mode&0o777,0o700);assert.equal(fs.statSync(join(h.run,'terminal.json')).mode&0o777,0o600);
 assert.equal(fs.existsSync(join(h.root,'evidence/current')),false);assert.equal(fs.existsSync(join(h.run,'operations/000001-observed.json')),true);
 const before=fs.readFileSync(join(h.run,'terminal.json')),commands=h.commands().length,requests=h.requests().length;assert.equal(h.execute().status,1);assert.equal(h.commands().length,commands);assert.equal(h.requests().length,requests);assert.deepEqual(fs.readFileSync(join(h.run,'terminal.json')),before);
});
test('actual client-credentials mode makes exactly four explicit issuer calls without token response leakage',posix,t=>{
 const h=benchmarkHarness(t);h.c.authMode='client-credentials';fs.writeFileSync(h.configFile,JSON.stringify(h.c));fs.writeFileSync(h.c.authFile,JSON.stringify({allowServiceAuthentication:true,targetOrigin:h.c.origin,allowedOrigins:[h.c.origin],issuer:h.c.origin+'/identity/realms/synthetic',clientId:'synthetic-benchmark',clientSecret:'INSECURE_SYNTHETIC_ONLY_CLIENT',timeoutMs:1000}));
 const r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.requests().filter(c=>c.url.endsWith('/protocol/openid-connect/token')).length,4);assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_SYNTHETIC_ONLY_CLIENT/);
 assert.equal(h.json(join(h.run,'authentication-0-observed.json')).tokenAndSecretWithheld,true);
});
test('actual import/bare/wrong command flags issue no native or API request and create no reservation',posix,t=>{
 const h=benchmarkHarness(t);assert.equal(h.importOnly().status,0);for(const args of [[],['--execute-replay-smoke'],['--execute-paired-replay','--input',h.configFile,'--retry']])assert.equal(h.execute({},args).status,1);
 assert.equal(h.commands().length,0);assert.equal(h.requests().length,0);assert.equal(fs.existsSync(h.run),false);
});
for(const extra of [{CI:'true'},{GITHUB_ACTIONS:'true'},{RELEASEGUARD_TOKEN:'INSECURE_AMBIENT_TOKEN'},{KUBECONFIG:'/unselected/kube'},{GOOGLE_APPLICATION_CREDENTIALS:'/unselected/gcp.json'}])test('automatic/ambient credentials refuse before command execution',posix,t=>{
 const h=benchmarkHarness(t),r=h.execute(extra);assert.equal(r.status,1);assert.equal(h.commands().length,0);assert.equal(h.requests().length,0);assert.equal(fs.existsSync(h.run),false);assert.doesNotMatch(r.stderr,/INSECURE_AMBIENT/);
});
for(const fault of ['wrong-namespace','command-failure','duplicate-command-response','failed-warmup','negative-time','unknown-post','intent-sync','observed-sync','terminal-sync'])test('actual '+fault+' remains failed/unknown with originals preserved and no repeat',posix,t=>{
 const h=benchmarkHarness(t),r=h.execute({RG_SYNTHETIC_BENCHMARK_FAULT:fault});assert.equal(r.status,1,r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_PRIVATE|INSECURE_SYNTHETIC/);
 const commands=h.commands().length,requests=h.requests().length;assert.equal(h.execute().status,1);assert.equal(h.commands().length,commands);assert.equal(h.requests().length,requests);
 const file=join(h.run,'terminal.json');assert.equal(fs.existsSync(file),true);if(fault!=='terminal-sync')assert.equal(h.json(file).passed,false);
 if(['failed-warmup','negative-time','unknown-post','intent-sync','observed-sync'].includes(fault))assert.equal(h.json(file).restoration.state,'restored');
 if(fault==='negative-time')assert.equal(h.json(file).summaries[0].rows.some(row=>row.completionMs===-1),true);
 if(fault==='wrong-namespace')assert.equal(h.requests().length,0);
});
test('selected identity receipt mismatch refuses before any command or credential use',posix,t=>{
 const h=benchmarkHarness(t);fs.appendFileSync(h.c.identity.path,' ');assert.equal(h.execute().status,1);assert.equal(h.commands().length,0);assert.equal(h.requests().length,0);
});
test('private selected input mode and kubeconfig plugin cannot fall back to ambient runtime',posix,t=>{
 const h=benchmarkHarness(t);fs.chmodSync(h.configFile,0o644);assert.equal(h.execute().status,1);fs.chmodSync(h.configFile,0o600);
 const k=h.json(h.c.cloud.kubeconfigFile);k.users[0].user.exec.command='/bin/sh';fs.writeFileSync(h.c.cloud.kubeconfigFile,JSON.stringify(k));assert.equal(h.execute().status,1);assert.equal(h.commands().length,0);
});
for(const selectedToken of ['', 'true', ' '])test('invalid selected token is refused before it can poison native cleanup credential-echo detection',posix,t=>{
 const h=benchmarkHarness(t);fs.writeFileSync(h.c.authFile,JSON.stringify({token:selectedToken}));const r=h.execute();assert.equal(r.status,1);assert.equal(h.requests().length,0);
 const terminal=h.json(join(h.run,'terminal.json'));assert.equal(terminal.passed,false);assert.equal(terminal.restoration.state,'restored');assert.equal(terminal.restoration.workerRestored,true);assert.equal(terminal.restoration.controllerRestored,true);
});
test('empty client secret is refused before issuer transport and does not poison owned cleanup',posix,t=>{
 const h=benchmarkHarness(t);h.c.authMode='client-credentials';fs.writeFileSync(h.configFile,JSON.stringify(h.c));fs.writeFileSync(h.c.authFile,JSON.stringify({allowServiceAuthentication:true,targetOrigin:h.c.origin,allowedOrigins:[h.c.origin],issuer:h.c.origin+'/identity/realms/synthetic',clientId:'synthetic',clientSecret:'',timeoutMs:1000}));
 const r=h.execute();assert.equal(r.status,1);assert.equal(h.requests().length,0);const terminal=h.json(join(h.run,'terminal.json'));assert.equal(terminal.passed,false);assert.equal(terminal.restoration.state,'restored');
});
for(const clientSecret of ['true','synthetic-worker-uid'])test('a secret colliding with already observed native data refuses before issuer transport and preserves cleanup',posix,t=>{
 const h=benchmarkHarness(t);h.c.authMode='client-credentials';fs.writeFileSync(h.configFile,JSON.stringify(h.c));fs.writeFileSync(h.c.authFile,JSON.stringify({allowServiceAuthentication:true,targetOrigin:h.c.origin,allowedOrigins:[h.c.origin],issuer:h.c.origin+'/identity/realms/synthetic',clientId:'synthetic',clientSecret,timeoutMs:1000}));
 const r=h.execute();assert.equal(r.status,1);assert.equal(h.requests().length,0);assert.equal(h.json(join(h.run,'terminal.json')).restoration.state,'restored');
});
test('malformed issuer token is withheld and refused before API transport without poisoning owned cleanup or retrying issuer',posix,t=>{
 const h=benchmarkHarness(t);h.c.authMode='client-credentials';fs.writeFileSync(h.configFile,JSON.stringify(h.c));fs.writeFileSync(h.c.authFile,JSON.stringify({allowServiceAuthentication:true,targetOrigin:h.c.origin,allowedOrigins:[h.c.origin],issuer:h.c.origin+'/identity/realms/synthetic',clientId:'synthetic',clientSecret:'INSECURE_SYNTHETIC_ONLY_CLIENT',timeoutMs:1000}));
 const r=h.execute({RG_SYNTHETIC_BENCHMARK_FAULT:'malformed-issuer-token'});assert.equal(r.status,1);assert.equal(h.requests().length,1);assert.equal(h.requests()[0].url.endsWith('/protocol/openid-connect/token'),true);
 const terminal=h.json(join(h.run,'terminal.json'));assert.equal(terminal.passed,false);assert.equal(terminal.restoration.state,'restored');assert.equal(h.json(join(h.run,'authentication-0-observed.json')).tokenAndSecretWithheld,true);
});
test('a genuine token echo after registration remains withheld and unknown, never a bypass for restoration',posix,t=>{
 const h=benchmarkHarness(t),r=h.execute({RG_SYNTHETIC_BENCHMARK_FAULT:'late-native-credential-echo'});assert.equal(r.status,1);const terminal=h.json(join(h.run,'terminal.json'));assert.equal(terminal.passed,false);assert.equal(terminal.restoration.controllerRestored,false);
 const observations=fs.readdirSync(h.run).filter(n=>n.endsWith('-observed.json')).map(n=>h.json(join(h.run,n)));assert.equal(observations.some(o=>o.credentialLikeContentWithheld===true&&o.rawStdout===null),true);
 for(const name of fs.readdirSync(h.run).filter(n=>n.endsWith('.json')))assert.equal(fs.readFileSync(join(h.run,name),'utf8').includes(token),false);assert.equal((r.stdout+r.stderr).includes(token),false);
});
