// Only the renderer's owned fixture files are accessible. All operational boundaries
// are rejected, not emulated as successful cloud/model/process operations.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import child from 'node:child_process';
import net from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const root=fs.realpathSync(process.env.RG_GCP_FIXTURE_ROOT ?? '');
if(!/[/\\]rg-gcp-infra-[^/\\]+$/.test(root)) throw Error('Owned infrastructure fixture required');
const marker=join(root,'forbidden-boundary'), writeMarker=fs.writeFileSync;
const pathOf=path=>resolve(path instanceof URL?fileURLToPath(path):String(path));
function deny(kind){writeMarker(marker,kind);throw Error('Forbidden offline boundary');}
function owned(path){const p=pathOf(path),r=relative(root,p);if(r==='..'||r.startsWith('../')||r.startsWith('..\\')||isAbsolute(r))deny('outside');return p;}
function reading(path){const p=owned(path);if(/[/\\](?:\.env(?:\.|$)|secrets?(?:\.|$)|id_(?:rsa|ed25519)(?:$|\.))/.test(p))deny('credential');return p;}
function writing(path){const p=owned(path),sep=process.platform==='win32'?'\\':'/',evidence=join(root,'evidence'),rendered=join(root,'deploy/k8s/rendered');if(p!==evidence&&!p.startsWith(evidence+sep)&&![join(root,'deploy'),join(root,'deploy/k8s'),rendered].includes(p)&&!p.startsWith(rendered+sep))deny('write-outside-plan');return p;}
for(const name of ['readFileSync']){const original=fs[name];fs[name]=(p,...args)=>original(reading(p),...args);}
const read=fsp.readFile;fsp.readFile=(p,...args)=>read(reading(p),...args);
const open=fsp.open;fsp.open=async(p,flags,...args)=>{
  const writingFlag=typeof flags==='number'?Boolean(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT)):!String(flags).startsWith('r');
  const path=writingFlag?writing(p):reading(p),handle=await open(path,flags,...args);
  if(process.env.RG_GCP_FIXTURE_FAIL==='infra-sync'&&path.endsWith('infra.json'))handle.sync=async()=>{throw Error('TEST ONLY SYNC FAILURE');};
  if(process.env.RG_GCP_FIXTURE_FAIL==='parent-sync'&&path===root)handle.sync=async()=>{throw Error('TEST ONLY PARENT SYNC FAILURE');};
  return handle;
};
for(const name of ['mkdir','writeFile']){const original=fsp[name];fsp[name]=(p,...args)=>original(writing(p),...args);}
for(const name of ['chmod','unlink','rm','rename'])fsp[name]=()=>deny(name);
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=()=>deny('process');
net.Socket.prototype.connect=()=>deny('TCP');globalThis.fetch=()=>deny('fetch');
syncBuiltinESMExports();

