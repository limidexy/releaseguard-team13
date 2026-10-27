// Private append-only comparison evidence. No overwrite, resume or public raw
// artifact. Hashes provide byte identity, not a signature or human identity.
import { constants } from 'node:fs';
import { lstat,mkdir,open } from 'node:fs/promises';
import { dirname,join,parse,relative } from 'node:path';
import { createHash } from 'node:crypto';
const deny=()=>{throw Error('Comparison files refused');};
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export async function noComparisonLinks(path){let p=parse(path).root;for(const part of relative(p,path).split(/[\\/]/).filter(Boolean)){p=join(p,part);if((await lstat(p)).isSymbolicLink())deny();}}
export async function syncComparisonDirectory(path){const h=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}}
async function directory(path,privateMode=true){let fresh=false;try{await mkdir(path,{mode:0o700});fresh=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||privateMode&&((s.mode&0o077)!==0||s.uid!==process.getuid()))deny();if(fresh)await syncComparisonDirectory(dirname(path));}
export async function comparisonBytes(path,{privateMode=false,limit=2*1024*1024}={}){
 await noComparisonLinks(path);if(privateMode){const parent=await lstat(dirname(path));if(!parent.isDirectory()||(parent.mode&0o077)!==0||parent.uid!==process.getuid())deny();}
 const before=await lstat(path,{bigint:true});if(!before.isFile()||before.size>BigInt(limit))deny();
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const initial=await h.stat({bigint:true});if(!initial.isFile()||initial.dev!==before.dev||initial.ino!==before.ino||initial.size>BigInt(limit)||
  privateMode&&((initial.mode&0o077n)!==0n||initial.uid!==BigInt(process.getuid())))deny();
  const bytes=Buffer.alloc(limit+1);let size=0;while(size<bytes.length){const r=await h.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
  const end=await h.stat({bigint:true});if(size>limit||end.size!==initial.size||end.mtimeNs!==initial.mtimeNs||end.ctimeNs!==initial.ctimeNs)deny();return bytes.subarray(0,size);
 }finally{await h.close();}
}
export function strictComparisonJSON(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),result=JSON.parse(text);let i=0;
 const space=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
 const string=()=>{const start=i++;while(i<text.length){if(text[i]==='\\')i+=2;else if(text[i++]==='"')break;}return JSON.parse(text.slice(start,i));};
 function value(depth){if(depth>64)deny();space();if(text[i]==='{'){i++;space();const keys=new Set();if(text[i]!=='}')for(;;){const key=string();if(keys.has(key))deny();keys.add(key);space();i++;value(depth+1);space();if(text[i]!==',')break;i++;space();}i++;}
  else if(text[i]==='['){i++;space();if(text[i]!==']')for(;;){value(depth+1);space();if(text[i]!==',')break;i++;}i++;}
  else if(text[i]==='"')string();else while(i<text.length&&!/[\s,\]}]/.test(text[i]))i++;}
 value(0);return result;
}
export function comparisonFiles(root,runId,namespace='comparison'){
 if(!['comparison','cloud-retained-rescore','cloud-evidence','cloud-benchmark','cloud-autoscale','cloud-worker-pause','cloud-backup'].includes(namespace)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId??''))deny();
 let output,total=0,recoveryTotal=0;
 async function put(name,bytes){
  const permitted=['cloud-benchmark','cloud-autoscale','cloud-worker-pause'].includes(namespace)?/^(?:operations\/\d{6}-(?:intent|observed|result|authentication)|[a-z0-9-]+)\.(?:json|bin)$/:/^(?:operations\/\d{4}-(?:intent|observed|result|authentication)|[a-z0-9-]+)\.(?:json|bin)$/;
  if(!output||!permitted.test(name))deny();
  await noComparisonLinks(dirname(join(output,name)));const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const h=await open(join(output,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await h.writeFile(b);await h.sync();}finally{await h.close();}await syncComparisonDirectory(dirname(join(output,name)));
  const recovery=namespace==='cloud-backup'?/^cleanup-(?:native-\d{6}-(?:intent|observed)|operation-\d{6}-(?:intent|observed|stdout|stderr))\.(?:json|bin)$/.test(name):['cloud-benchmark','cloud-autoscale','cloud-worker-pause'].includes(namespace)&&/^cleanup-(?:native-\d{6}-(?:intent|observed|result)|kube-patch-\d{6})\.json$/.test(name);
  if(recovery)recoveryTotal+=b.length;else total+=b.length;
  // Preserve the last bounded response, then stop; this is not a hard byte quota.
  // These operator tools have a separate16MiB recovery receipt allowance. This
  // is accounting, not a disk reservation or hard physical byte quota.
  // Only backups allow three64MiB custom archives plus bounded receipts.
  if((recovery?recoveryTotal>16*1024*1024:total>(namespace==='cloud-backup'?256:64)*1024*1024)&&name!=='terminal.json')deny();
 }
 const json=(name,v)=>put(name,JSON.stringify(v,null,2)+'\n');
 return {get owned(){return Boolean(output);},get directory(){return output;},json,put,
  async reserve(metadata){await noComparisonLinks(root);let parent=root;for(const [part,priv]of [['evidence',false],['private',true],[namespace,true]]){parent=join(parent,part);await directory(parent,priv);}
   const proposed=join(parent,runId);await mkdir(proposed,{mode:0o700});output=proposed;await syncComparisonDirectory(parent);
   await json('started.json',metadata);await directory(join(output,'operations'));},
 };
}
