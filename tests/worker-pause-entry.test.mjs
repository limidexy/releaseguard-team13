import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {workerPauseHarness} from './fixtures/worker-pause-cli-harness.mjs';
import {token} from './fixtures/worker-pause-protocol.mjs';
const posix={skip:process.platform==='win32'?'Private fsync/operator entry is POSIX-only':false};
test('actual CLI full500protocol uses private receipts, bounded selected commands, authenticates2times and restores; same run cannot resume',posix,t=>{
 const h=workerPauseHarness(t),r=h.execute();assert.equal(r.status,0,r.stderr);const term=h.json(join(h.run,'terminal.json'));assert.equal(term.passed,true);assert.equal(term.requests,1002);assert.equal(term.observedVerified,500);
 assert.equal(term.restoration.state,'restored');assert.equal(term.rawObservedPauseMs,17000);assert.equal(h.requests().length,1002);assert.equal(term.automaticScaleOutObserved,true);
 assert.equal(h.commands().filter(c=>c.kind==='fault-start').length,1);assert.equal(h.commands().some(c=>c.args.some(a=>['apply','delete','resize','get-credentials'].includes(a))),false);
 assert.equal(fs.statSync(h.run).mode&0o777,0o700);assert.equal(fs.statSync(join(h.run,'terminal.json')).mode&0o777,0o600);assert.equal(fs.existsSync(join(h.root,'evidence/current')),false);
 const before=fs.readFileSync(join(h.run,'terminal.json')),commands=h.commands().length,requests=h.requests().length;assert.equal(h.execute().status,1);assert.equal(h.commands().length,commands);assert.equal(h.requests().length,requests);assert.deepEqual(fs.readFileSync(join(h.run,'terminal.json')),before);
});
test('actual client-credentials mode has exactly2issuerrequests, no secret or token evidence',posix,t=>{
 const h=workerPauseHarness(t);h.c.authMode='client-credentials';fs.writeFileSync(h.configFile,JSON.stringify(h.c));fs.writeFileSync(h.c.authFile,JSON.stringify({allowServiceAuthentication:true,targetOrigin:h.c.origin,allowedOrigins:[h.c.origin],issuer:h.c.origin+'/identity/realms/synthetic',clientId:'synthetic-worker-pause',clientSecret:'INSECURE_SYNTHETIC_ONLY_CLIENT',timeoutMs:1000}));
 const r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.requests().filter(r=>r.url.endsWith('/protocol/openid-connect/token')).length,2);assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_SYNTHETIC_ONLY_CLIENT/);
 for(const name of fs.readdirSync(h.run).filter(n=>n.endsWith('.json')))assert.equal(fs.readFileSync(join(h.run,name),'utf8').includes(token),false);
});
test('import,bare and inherited smoke flags cannot activate a different mutating tool',posix,t=>{
 const h=workerPauseHarness(t);assert.equal(h.importOnly().status,0);for(const args of [[],['--execute-replay-smoke'],['--execute-worker-pause-replay','--input',h.configFile,'--retry']])assert.equal(h.execute({RG_ALLOW_CLOUD_SMOKE:'true',RG_CLOUD_ALLOWED_ORIGINS:h.c.origin},args).status,1);
 assert.equal(h.requests().length,0);assert.equal(h.commands().length,0);assert.equal(fs.existsSync(h.run),false);
});
for(const extra of [{CI:'true'},{GITHUB_ACTIONS:'true'},{RELEASEGUARD_TOKEN:'INSECURE_AMBIENT_TOKEN'},{KUBECONFIG:'/unselected/kube'}])test('automatic/ambient invocation refuses before IO',posix,t=>{
 const h=workerPauseHarness(t),r=h.execute(extra);assert.equal(r.status,1);assert.equal(h.requests().length,0);assert.equal(h.commands().length,0);assert.equal(fs.existsSync(h.run),false);
});
for(const fault of ['wrong-namespace','command-failure','duplicate-command-response','unknown-post','duplicate-job','negative-time','foreign-replica','cleanup-failure','intent-sync','observed-sync','terminal-sync','late-credential-echo','foreign-pod','unknown-start-after','unknown-cont'])test('actual '+fault+' remains failed/unknown without a repeat',posix,t=>{
 const h=workerPauseHarness(t),r=h.execute({RG_SYNTHETIC_WORKER_PAUSE_FAULT:fault});assert.equal(r.status,1,r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_PRIVATE|INSECURE_SYNTHETIC/);
 const commands=h.commands().length,requests=h.requests().length;assert.equal(h.execute().status,1);assert.equal(h.commands().length,commands);assert.equal(h.requests().length,requests);
 assert.equal(fs.existsSync(join(h.run,'terminal.json')),true);if(fault!=='terminal-sync')assert.equal(h.json(join(h.run,'terminal.json')).passed,false);
 if(fault==='unknown-post'){assert.ok(h.requests().length<=10);assert.equal(h.json(join(h.run,'terminal.json')).denominator,500);}
 if(['foreign-pod','unknown-start-after'].includes(fault))assert.equal(h.requests().length,2);
});
for(const selectedToken of ['', 'true', ' '])test('invalid selected token is rejected before credential registration and target mutation',posix,t=>{
 const h=workerPauseHarness(t);fs.writeFileSync(h.c.authFile,JSON.stringify({token:selectedToken}));assert.equal(h.execute().status,1);assert.equal(h.requests().length,0);assert.equal(h.commands().some(c=>c.kind.startsWith('patch-')),false);
});
test('selected private identity/source inputs and executable config remain bound',posix,t=>{
 const h=workerPauseHarness(t);fs.chmodSync(h.configFile,0o644);assert.equal(h.execute().status,1);fs.chmodSync(h.configFile,0o600);fs.appendFileSync(h.c.identity.path,' ');assert.equal(h.execute().status,1);assert.equal(h.commands().length,0);assert.equal(h.requests().length,0);
});
test('actual CLI retains explicit pausedone handoff capability without claiming restored originalstate ordeployment',posix,t=>{
 const h=workerPauseHarness(t);h.c.postcondition='paused-one-for-cd';fs.writeFileSync(h.configFile,JSON.stringify(h.c));const r=h.execute();assert.equal(r.status,0,r.stderr);
 const term=h.json(join(h.run,'terminal.json'));assert.equal(term.restoration.pausedOneHandoff,true);assert.equal(term.restoration.originalStateRestored,false);assert.equal(term.cloudCostOrDeploymentAccepted,false);
});
for(const clientSecret of ['', 'true', 'synthetic-worker-uid'])test('invalid orambiguous clientsecret refuses beforeissuertransport andtargetmutation',posix,t=>{
 const h=workerPauseHarness(t);h.c.authMode='client-credentials';fs.writeFileSync(h.configFile,JSON.stringify(h.c));fs.writeFileSync(h.c.authFile,JSON.stringify({allowServiceAuthentication:true,targetOrigin:h.c.origin,allowedOrigins:[h.c.origin],issuer:h.c.origin+'/identity/realms/synthetic',clientId:'synthetic-worker-pause',clientSecret,timeoutMs:1000}));
 assert.equal(h.execute().status,1);assert.equal(h.requests().length,0);assert.equal(h.commands().some(c=>c.kind.startsWith('patch-')),false);
});
test('malformed issuerreturn is withheld without anAPIrequest orautomaticissuerretry',posix,t=>{
 const h=workerPauseHarness(t);h.c.authMode='client-credentials';fs.writeFileSync(h.configFile,JSON.stringify(h.c));fs.writeFileSync(h.c.authFile,JSON.stringify({allowServiceAuthentication:true,targetOrigin:h.c.origin,allowedOrigins:[h.c.origin],issuer:h.c.origin+'/identity/realms/synthetic',clientId:'synthetic-worker-pause',clientSecret:'INSECURE_SYNTHETIC_ONLY_CLIENT',timeoutMs:1000}));
 assert.equal(h.execute({RG_SYNTHETIC_WORKER_PAUSE_FAULT:'malformed-issuer-token'}).status,1);assert.equal(h.requests().length,1);
 assert.equal(h.json(join(h.run,'authentication-0-observed.json')).outcome,'token_returned_unconfirmed');assert.equal(h.commands().some(c=>c.kind==='fault-start'),false);assert.equal(h.json(join(h.run,'terminal.json')).restoration.originalStateRestored,true);
});
