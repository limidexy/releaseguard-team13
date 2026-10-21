import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const destination='docs/evidence/route-contract-alignment-2026-10-21';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[];
async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(path===destination)continue;if(entry.isDirectory())await scan(path);else if(entry.isFile())files.push({path,sha256:hash(await readFile(path))});}}
// Preservation inventory only; no historical evaluation or source rewriting.
for(const root of ['src','tests','scripts','docs/evidence'])await scan(root);
for(const path of ['package.json','package-lock.json','tsconfig.json'])files.push({path,sha256:hash(await readFile(path))});
await mkdir(destination);
await writeFile(destination+'/PRESERVATION-BEFORE.json',JSON.stringify({recordedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}),scope:'Existing source, tests, scripts, evidence and build definitions, including untracked files; no restore from HEAD.',files:files.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({destination,preservedFiles:files.length}));
