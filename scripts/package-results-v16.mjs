import {readFile,writeFile,cp,mkdir,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

const target='handoff-v30-v16-reviewed';
const archive=resolve('../ReleaseGuard_v30_v16_Results_20261016.zip');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=(from,to)=>cp(from,to,{recursive:true,force:false,errorOnExist:true});

await mkdir(target+'/evidence',{recursive:true});
for(const name of ['model-v15-2026-10-16','model-v16-2026-10-16'])
  await copy('docs/evidence/'+name,target+'/evidence/'+name);

const original='/Users/ASUS/Desktop/nus- learning/ReleaseGuard_Team13/docs/evidence';
await mkdir(target+'/evidence/model-v3-2026-10-14',{recursive:true});
for(const name of ['plan.json','real-v3-2026-10-14T14-06-07.034Z.json','real-v4-2026-10-14T14-15-23.420Z.json','real-v5-2026-10-14T14-25-15.496Z.json'])
  await copy(original+'/model-v3-2026-10-14/'+name,target+'/evidence/model-v3-2026-10-14/'+name);
await mkdir(target+'/evidence/cloud-2026-10-11-retest',{recursive:true});
await copy(original+'/cloud-2026-10-11-retest/prompt-comparison-real-1791729589074.json',target+'/evidence/cloud-2026-10-11-retest/prompt-comparison-real-1791729589074.json');

await copy('/tmp/rg-v16-final-tests.log',target+'/evidence/model-v16-2026-10-16/final-clean-patch-tests.log');
await copy('/tmp/rg-v16-stop.log',target+'/evidence/model-v16-2026-10-16/stop-containers.log');

await mkdir(target+'/reproduction-scripts',{recursive:true});
for(const name of ['offline-v16.mjs','model-v16-evaluation.mjs','verify-model-v16.mjs','summarize-model-v16.mjs','verify-controlled-v30-local.mjs','verify-v28-v12-local.mjs'])
  await copy('scripts/'+name,target+'/reproduction-scripts/'+name);

const secretValues=[];
for(const file of ['.env','/Users/ASUS/Desktop/nus- learning/ReleaseGuard_Team13/.env.groq']){
  const values=parseEnv(await readFile(file,'utf8'));
  for(const [key,value] of Object.entries(values))
    if(/KEY|SECRET|PASSWORD/.test(key)&&value.length>=12)secretValues.push(value);
}
async function files(dir){
  const found=[];
  for(const name of await readdir(dir)){
    const path=dir+'/'+name;
    if((await stat(path)).isDirectory())found.push(...await files(path));else found.push(path);
  }
  return found.sort();
}

const manifest=[];
for(const path of await files(target)){
  if(/\/(?:\.env[^/]*|\.git)(?:\/|$)/.test(path))throw Error('Forbidden packaged path: '+path);
  const bytes=await readFile(path),text=bytes.toString('utf8');
  if(secretValues.some(value=>text.includes(value))||/\bgsk_[A-Za-z0-9]{25,}|\bgh[pousr]_[A-Za-z0-9]{25,}/.test(text))
    throw Error('Secret scan failed; value withheld');
  manifest.push({path:path.slice(target.length+1),bytes:bytes.length,sha256:sha(bytes)});
}
await writeFile(target+'/manifest.json',JSON.stringify({packagedAt:new Date().toISOString(),secretMatches:0,remotePush:false,files:manifest},null,2)+'\n',{flag:'wx'});

try{await stat(archive);throw Error('Refusing to overwrite archive');}catch(error){if(error.code!=='ENOENT')throw error;}
execFileSync('/usr/bin/zip',['-qr',archive,target],{stdio:'pipe'});
execFileSync('/usr/bin/unzip',['-tq',archive],{stdio:'pipe'});
console.log(JSON.stringify({archive,files:manifest.length+1,secretMatches:0,sha256:sha(await readFile(archive))}));
