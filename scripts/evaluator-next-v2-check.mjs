// Save local test evidence without overwriting earlier runs. No provider/network transport.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const destination=process.argv[2],files=process.argv.slice(3);
if(!destination?.startsWith('docs/evidence/evaluator-next-v2-')||!files.length||files.some(f=>!/^dist\/tests\/[a-zA-Z0-9-]+\.test\.js$/.test(f)))throw Error('Use a new evidence file and explicit compiled test paths');
const r=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{encoding:'utf8',maxBuffer:20000000});
const original=(r.stdout??'')+(r.stderr??''),text=original.replaceAll(process.cwd(),'<REPOSITORY>').replaceAll(process.cwd().replaceAll(' ','%20'),'<REPOSITORY>');
const count=key=>Number(original.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1]??0);
const report={executedAt:new Date().toISOString(),node:process.version,command:['node','--test','--test-reporter=tap',...files],exitCode:r.status,signal:r.signal,startError:r.error?.message??null,total:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),newModelCalls:0,newReviewerCalls:0,output:text};
report.outputSha256=createHash('sha256').update(text).digest('hex');
await fs.writeFile(destination,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,output:undefined},null,2));process.exit(r.status??1);
