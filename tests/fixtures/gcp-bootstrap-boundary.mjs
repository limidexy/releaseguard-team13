// Hermetic child preloader: the CLI runs, but OpenSSL/random production and all
// network boundaries are replaced. Its keys are public insecure TEST fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { join,resolve } from 'node:path';
import { materialFixture } from './gcp-bootstrap-data.mjs';
import { insecureFixtureCAKey } from './gcp-private-data.mjs';
const root=fs.realpathSync(process.env.RG_BOOTSTRAP_FIXTURE_ROOT),log=join(root,'boundary-events.jsonl');
assert.match(root.split(/[\\/]/).at(-1),/^rg-bootstrap-/);
const event=v=>fs.appendFileSync(log,JSON.stringify(v)+'\n',{mode:0o600});
const forbidden=()=>{fs.writeFileSync(join(root,'forbidden-boundary'),'blocked',{mode:0o600});throw Error('Forbidden real boundary');};
for(const k of ['exec','execSync','execFile','execFileSync','fork','spawnSync'])cp[k]=forbidden;
net.Socket.prototype.connect=forbidden;net.connect=net.createConnection=forbidden;globalThis.fetch=forbidden;
http.get=http.request=https.get=https.request=forbidden;
for(const k of ['generateKeyPair','generateKeyPairSync','generatePrime','generatePrimeSync'])crypto[k]=forbidden;
let random=0,ids=0,commands=0,caStart;
crypto.randomBytes=n=>{
 assert.ok(n===36||n===16);event({kind:'fake-random',n});const b=Buffer.alloc(n);b[n-1]=++random;return b;
};
crypto.randomUUID=()=>{event({kind:'fake-uuid'});return '00000000-0000-4000-8000-'+String(++ids).padStart(12,'0');};
const put=(cwd,name,value)=>{assert.equal(resolve(cwd,name),join(cwd,name));fs.writeFileSync(join(cwd,name),value,{flag:'wx',mode:0o600});};
cp.spawn=(exe,args,options)=>{
 const cwd=options.cwd;assert.ok(cwd.startsWith(join(root,'evidence/private/gcp-bootstrap/')));
 assert.equal(exe,'/usr/bin/openssl');assert.equal(options.detached,true);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
 assert.deepEqual(Object.keys(options.env).sort(),['LANG','LC_ALL','OPENSSL_CONF','PATH','RANDFILE']);
 assert.equal(options.env.PATH,'/usr/bin:/bin');assert.equal(options.env.OPENSSL_CONF,join(cwd,'openssl-empty.cnf'));assert.equal(options.env.RANDFILE,join(cwd,'random-state'));
 const entries=fs.readdirSync(join(cwd,'operations')),last=entries.filter(n=>n.endsWith('-intent.json')).sort().at(-1);
 const intent=JSON.parse(fs.readFileSync(join(cwd,'operations',last),'utf8'));assert.deepEqual(intent.args,args);
 event({kind:'fake-command',args,cwd:cwd.slice(root.length)});const n=++commands;
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 queueMicrotask(()=>{
  if(process.env.RG_BOOTSTRAP_FIXTURE_FAIL==='command-'+n){child.stderr.emit('data','PRIVATE_FAILURE_DO_NOT_PRINT');child.emit('close',7,null);return;}
  if(args[0]==='version')child.stdout.emit('data',process.env.RG_BOOTSTRAP_FIXTURE_VERSION??'OpenSSL 3.0.17 TEST ONLY');
  else if(args[0]==='req'&&args.includes('-x509')){
   caStart=Math.floor(Date.now()/1000)*1000;const f=materialFixture(caStart);put(cwd,'ca.crt',f.tls.ca);put(cwd,'ca.key',insecureFixtureCAKey());
  }else if(args[0]==='req'){
   assert.ok(caStart);const name=args[args.indexOf('-out')+1].replace('.csr',''),f=materialFixture(caStart);
   assert.ok(['postgres','rabbitmq'].includes(name));put(cwd,name+'.key',f.tls[name].key);put(cwd,name+'.csr','SYNTHETIC TEST CSR PLACEHOLDER');
  }else if(args[0]==='ca'){
   assert.ok(caStart);const name=args[args.indexOf('-out')+1].replace('.crt','');assert.ok(['postgres','rabbitmq'].includes(name));
   const decode=s=>Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(8,10),+s.slice(10,12),+s.slice(12,14));
   put(cwd,name+'.crt',materialFixture(caStart,decode(args[args.indexOf('-startdate')+1]),decode(args[args.indexOf('-enddate')+1])).tls[name].certificate);
   // OpenSSL owns these new-run mutable issuer files; original evidence is not touched.
   fs.writeFileSync(join(cwd,'index.txt'),name+' SYNTHETIC TEST CA INDEX\n');
  }else forbidden();
  child.emit('close',0,null);
 });return child;
};
const originalOpen=fsp.open;let failCount=0;
fsp.open=async(...args)=>{
 const f=await originalOpen(...args),p=String(args[0]),sync=f.sync.bind(f);
 f.sync=async()=>{
  const kind=process.env.RG_BOOTSTRAP_FIXTURE_FAIL;
  if((kind==='terminal-sync'&&p.endsWith('/terminal.json')||kind==='started-sync'&&p.endsWith('/started.json')||kind==='materials-sync'&&p.endsWith('/materials.json'))&&failCount++===0){event({kind:'fake-fsync-failure',file:p.split('/').at(-1)});throw Error('PRIVATE_FSYNC_FAILURE_DO_NOT_PRINT');}
  return sync();
 };return f;
};
syncBuiltinESMExports();
