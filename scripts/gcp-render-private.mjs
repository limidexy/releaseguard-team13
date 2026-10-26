// Explicit POSIX/Node24 private-input plan writer. It never generates operational
// material, logs input values, changes passwords/accounts or applies resources.
import { constants, realpathSync } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGcpPrivateInputs } from './gcp-private-core.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..');
const hash=data=>createHash('sha256').update(data).digest('hex'),refuse=()=>{throw Error('Private input render refused');};
async function noLinks(path){
 let current=parse(path).root;
 for(const part of relative(current,path).split(/[\\/]/).filter(Boolean)){
  current=join(current,part);if((await lstat(current)).isSymbolicLink())refuse();
 }
}
async function directory(path,privateMode){
 let created=false;try{await mkdir(path,{mode:0o700});created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||privateMode&&((s.mode&0o077)!==0||s.uid!==process.getuid()))refuse();
 if(created)await syncDirectory(dirname(path));
}
async function syncDirectory(path){const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{if(!(await f.stat()).isDirectory())refuse();await f.sync();}finally{await f.close();}}
async function readFile(path,privateInput=false){
 await noLinks(path);
 if(privateInput){const parent=await lstat(dirname(path));if(!parent.isDirectory()||(parent.mode&0o077)!==0||parent.uid!==process.getuid())refuse();}
 const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const before=await f.stat();
  if(!before.isFile()||before.size>262144||privateInput&&((before.mode&0o077)!==0||before.uid!==process.getuid()))refuse();
  const bytes=await f.readFile(),after=await f.stat();
  if(bytes.length>262144||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)refuse();
  return bytes;
 }finally{await f.close();}
}
async function writeFile(output,name,data){
 await noLinks(output);
 const f=await open(join(output,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
 try{await f.writeFile(data);await f.sync();}finally{await f.close();}
 await syncDirectory(output);
}
export async function runPrivateInputRenderer(args){
 let phase='arguments',output;
 try{
  if(process.platform==='win32'||Number(process.versions.node.split('.')[0])<24)refuse();
  if(args.length!==5||args[0]!=='--offline'||args[1]!=='--input'||args[3]!=='--run-id'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args[4]??''))refuse();
  if((await lstat(process.argv[1]??script)).isSymbolicLink())refuse();
  const inputPath=resolve(args[2]);
  if(/^\.env(?:\.|$)|^id_(?:rsa|ed25519)(?:\.|$)|\.(?:key|pem|crt)$/.test(basename(inputPath)))refuse();
  phase='inputs';
  const bytes=await readFile(inputPath,true),now=Date.now(),result=renderGcpPrivateInputs(JSON.parse(bytes.toString('utf8')),now),sources={};
  for(const name of ['scripts/gcp-render-private.mjs','scripts/gcp-private-core.mjs','scripts/gcp-infra-core.mjs'])sources[name]=hash(await readFile(join(root,name)));
  phase='reservation';await noLinks(root);let parent=root;
  for(const [name,privateMode]of [['evidence',false],['private',true],['gcp-inputs',true]]){parent=join(parent,name);await directory(parent,privateMode);}
  const proposed=join(parent,args[4]);await mkdir(proposed,{mode:0o700});output=proposed;await syncDirectory(parent);
  await writeFile(output,'started.json',JSON.stringify({formatVersion:1,runId:args[4],state:'started',planOnly:true,inputSHA256:hash(bytes),sourceSHA256:sources,hashesAreNotIdentityOrBuildAttestations:true})+'\n');
  phase='output';
  const privateBytes=JSON.stringify(result.secrets,null,2)+'\n';await writeFile(output,'secrets-k8s.json',privateBytes);
  await writeFile(output,'completed.json',JSON.stringify({...result.metadata,runId:args[4],inputSHA256:hash(bytes),outputSHA256:hash(privateBytes),sourceSHA256:sources},null,2)+'\n');
  console.log('Private inputs rendered only. No operational key, password, identity, model or deployment operation performed.');
  return 0;
 }catch{
  if(output){try{await writeFile(output,'failed.json',JSON.stringify({state:'failed',phase,planOnly:true,resumeAllowed:false})+'\n');}catch{/* Old/unknown private evidence is never overwritten. */}}
  console.error('Private input render refused ('+phase+'). Input values and private errors are not printed; no deployment performed.');
  return 1;
 }
}
function isMain(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(isMain())process.exitCode=await runPrivateInputRenderer(process.argv.slice(2));

