import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const entry=path.resolve(root,'../releaseguard-archss-freeze-20261025-r1/final/demo-entry');
const mode=process.argv[2];
if(!['before','after'].includes(mode))throw Error('Use before or after');
await fs.mkdir(path.join(root,'original'),{recursive:true});
if(mode==='before')for(const name of ['entry.js','readonly.html','contributor.html'])await fs.copyFile(path.join(entry,name),path.join(root,'original',name),fs.constants.COPYFILE_EXCL);
const source=await fs.readFile(path.join(entry,'entry.js'),'utf8');
async function run({fetchError,status=200,jsonError,clipboardError,clipboardMissing=false,role='viewer',invalid=false}={}){
 let action,fetches=0,copies=0;
 const button={disabled:false,addEventListener(event,fn){assert.equal(event,'click');action=fn;}};
 const statusNode={textContent:''};
 const document={body:{dataset:{role}},getElementById(id){return id==='copy'?button:statusNode;}};
 const navigator=clipboardMissing?{}:{clipboard:{async writeText(value){copies++;assert.equal(value,'synthetic-test-value-not-a-credential');if(clipboardError)throw Error('denied');}}};
 const fetch=async(url,options)=>{fetches++;assert.equal(url,'/token/'+role);assert.equal(options.method,'POST');if(fetchError)throw Error('offline');return {ok:status===200,status,async json(){if(jsonError)throw Error('not json');return invalid?{}:{token:'synthetic-test-value-not-a-credential',role,workspace:'presentation-rehearsal-1792392871535',expiresInSeconds:900};}};};
 vm.runInNewContext(source,{document,navigator,fetch,AbortSignal,Date,Intl,Error});
 await action();assert.equal(button.disabled,false);assert(!statusNode.textContent.includes('synthetic-test-value'));
 return {message:statusNode.textContent,fetches,copies};
}
const cases=[
 ['successful copy explains manual connection',{},r=>{assert.match(r.message,/Access token/);assert.match(r.message,/刷新|Refresh/);assert.equal(r.fetches,1);assert.equal(r.copies,1);}],
 ['network failure is not a clipboard error',{fetchError:true},r=>{assert.match(r.message,/生成.*失败|生成.*未完成/);assert.equal(r.copies,0);assert.equal(r.fetches,1);}],
 ['origin failure identifies HTTP403',{status:403},r=>{assert.match(r.message,/403/);assert.equal(r.copies,0);}],
 ['clipboard denial does not claim connected',{clipboardError:true},r=>{assert.match(r.message,/已生成.*未复制/);assert.match(r.message,/剪贴板/);assert.equal(r.fetches,1);}],
 ['clipboard unavailable is distinct',{clipboardMissing:true},r=>{assert.match(r.message,/已生成.*未复制/);assert.equal(r.fetches,1);}],
 ['invalid response never copies',{invalid:true},r=>{assert.match(r.message,/返回.*无效|响应.*无效/);assert.equal(r.copies,0);}],
 ['contributor stays contributor',{role:'contributor'},r=>{assert.match(r.message,/contributor/);assert.equal(r.fetches,1);assert.equal(r.copies,1);}]
];
const results=[];
for(const [name,args,check]of cases){try{check(await run(args));results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message.split('\n')[0]});}}
const result={at:new Date().toISOString(),mode,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,tests:results,scope:'UI-only deterministic error handling, simulated transport and clipboard; not a live API or replay run',models:0,jobPosts:0,cloud:0};
const runName=process.argv[3]??mode;
if(!/^[a-z0-9-]+$/.test(runName))throw Error('Invalid evidence name');
await fs.writeFile(path.join(root,runName+'-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
if(result.failed)process.exitCode=1;
