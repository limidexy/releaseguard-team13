import fs from 'node:fs';
import fsp from 'node:fs/promises';
import child from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import { isAbsolute,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const root=fs.realpathSync(process.env.RG_PRIVATE_FIXTURE_ROOT??'');
if(!/[/\\]rg-private-input-[^/\\]+$/.test(root))throw Error('Owned private-input fixture required');
const mark=fs.writeFileSync;
function deny(kind){mark(join(root,'forbidden-boundary'),kind);throw Error('Forbidden private-input boundary');}
function owned(p){p=resolve(p instanceof URL?fileURLToPath(p):String(p));const r=relative(root,p);if(r==='..'||r.startsWith('../')||r.startsWith('..\\')||isAbsolute(r))deny('outside');return p;}
function read(p){p=owned(p);if(/[/\\]\.env(?:\.|$)|[/\\]id_(?:rsa|ed25519)/.test(p))deny('implicit-credential');return p;}
function write(p){p=owned(p);const r=relative(join(root,'evidence'),p);if(r==='..'||r.startsWith('../')||r.startsWith('..\\')||isAbsolute(r))deny('write-outside-evidence');return p;}
const originalRead=fsp.readFile;fsp.readFile=(p,...a)=>originalRead(read(p),...a);
const originalOpen=fsp.open;fsp.open=async(p,flags,...a)=>{
 const writing=typeof flags==='number'?Boolean(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT)):!String(flags).startsWith('r');
 p=writing?write(p):read(p);const handle=await originalOpen(p,flags,...a);
 if(process.env.RG_PRIVATE_FIXTURE_FAIL==='private-sync'&&p.endsWith('secrets-k8s.json'))handle.sync=async()=>{throw Error('TEST ONLY PRIVATE SYNC ERROR');};
 return handle;
};
for(const name of ['mkdir','writeFile']){const original=fsp[name];fsp[name]=(p,...a)=>original(write(p),...a);}
for(const name of ['chmod','unlink','rm','rename'])fsp[name]=()=>deny(name);
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=()=>deny('process');
for(const name of ['generateKey','generateKeySync','generateKeyPair','generateKeyPairSync','generatePrime','generatePrimeSync','randomBytes','randomUUID'])crypto[name]=()=>deny('generation');
net.Socket.prototype.connect=()=>deny('TCP');globalThis.fetch=()=>deny('fetch');
syncBuiltinESMExports();

