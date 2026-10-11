import { spawnSync, execFileSync } from 'node:child_process';
import { readdir,readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
// Run from the project root. Only loopback replay is exercised; no credentials are printed.
if(process.env.RELEASEGUARD_URL && !['localhost','127.0.0.1'].includes(new URL(process.env.RELEASEGUARD_URL).hostname))throw Error('Local acceptance only');
const localEnv = await readFile('.env', 'utf8');
if (process.env.ALLOW_REAL_MODEL === 'true' || /^ALLOW_REAL_MODEL\s*=\s*["']?true["']?\s*$/mi.test(localEnv)) throw Error('Disable ALLOW_REAL_MODEL before running free local acceptance');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await mkdir('evidence/current',{recursive:true});
async function manifest(dir='.'){
  const rows=[];
  for(const ent of await readdir(dir,{withFileTypes:true})){
    if(['node_modules','dist','.git','evidence'].includes(ent.name)||ent.name.startsWith('.env'))continue;
    const p=path.join(dir,ent.name);if(ent.isDirectory())rows.push(...await manifest(p));
    else if(ent.isFile())rows.push({path:p,sha256:createHash('sha256').update(await readFile(p)).digest('hex')});
  }return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
const report={startedAt:new Date().toISOString(),scope:'Local Docker replay verification; no cloud/real provider/hosted CI claims',node:process.version,composeProject:process.env.COMPOSE_PROJECT_NAME??'releaseguard-team13',gitCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),gitDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),sourceFiles:await manifest(),steps:[]};
const steps=[
 ['unit-tests',npmCommand,['test']],
 ['container-build','docker',['compose','build','gateway','postgres']],
 ['container-start','docker',['compose','up','-d','--no-build','--wait']],
 ['integration',process.execPath,['scripts/verify.mjs','--restart']],
 ['improvements',process.execPath,['scripts/verify-improvements.mjs']],
 ['ddd-contracts',process.execPath,['scripts/verify-contracts.mjs']],
 ['fault-recovery',process.execPath,['scripts/fault-test.mjs']],
 ['prompt-replay',process.execPath,['scripts/compare-prompts.mjs','replay']],
 ['repeated-scaling',process.execPath,['scripts/benchmark-repeated.mjs']],
 ['mixed-read-write',process.execPath,['scripts/mixed-load.mjs']],
 ['dependency-audit',npmCommand,['audit','--audit-level=high','--json']],
];
for(const [name,command,args] of steps){
  console.log('RUN '+name);const start=Date.now();
  const r=spawnSync(command,args,{encoding:'utf8',timeout:600000,maxBuffer:10*1024*1024,env:process.env});
  const log=`${r.stdout??''}\n${r.stderr??''}\n${r.error?String(r.error):''}`;
  await writeFile(`evidence/current/${name}.log`,log);
  report.steps.push({name,command:path.basename(command)+' '+args.join(' '),exitCode:r.status,durationMs:Date.now()-start,error:r.error?String(r.error):null,log:`evidence/current/${name}.log`});
  console.log(`${name}: ${r.status===0?'PASS':'FAIL'} (${Date.now()-start} ms)`);
  if(r.status!==0){process.exitCode=1;break;}
}
report.finishedAt=new Date().toISOString();report.allPlannedLocalStepsPassed=report.steps.length===steps.length&&report.steps.every(s=>s.exitCode===0);
report.cloudDeployed=false;report.realModelExecuted=false;report.hostedCIExecuted=false;
const endManifest=await manifest();report.sourceUnchangedDuringRun=JSON.stringify(report.sourceFiles)===JSON.stringify(endManifest);
if(!report.sourceUnchangedDuringRun)process.exitCode=1;
await writeFile('evidence/current/acceptance.json',JSON.stringify(report,null,2));
console.log('Evidence: evidence/current/acceptance.json');
