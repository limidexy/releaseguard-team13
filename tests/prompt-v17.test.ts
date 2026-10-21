import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {jobSchema} from '../src/domain.js';
import {promptSnapshot,promptTemplates,providerAnswer} from '../src/provider.js';

const job={appId:'00000000-0000-4000-8000-000000000001',suiteId:'00000000-0000-4000-8000-000000000002',candidate:'prompt-v17',commitRef:'local-only-v17',source:'real',promptVersion:'v17'};
test('v17 is selectable while v18 remains rejected',()=>{assert.equal(jobSchema.safeParse(job).success,true);assert.equal(jobSchema.safeParse({...job,promptVersion:'v18'}).success,false);});
test('v17 fixed prompt is shorter than v16 and declares the contract boundary',()=>{assert.ok(promptTemplates.v17.length<promptTemplates.v16.length);assert.match(promptTemplates.v17,/satisfy every mustState and mustAsk/i);assert.match(promptTemplates.v17,/human review and clarification duties can apply together/i);});
test('v17 compiles a contract, calls once, and preserves the raw answer',async()=>{
 let calls=0,request:any;const question='My item arrived damaged. What should I do?',raw='Raw fixture deliberately preserved.';
 const result=await providerAnswer({url:'https://mock.invalid/chat',key:'mock',model:'mock'},'v17',question,(async(_url:any,init:any)=>{calls++;request=JSON.parse(init.body);return new Response(JSON.stringify({id:'mock-v17',model:'mock',choices:[{message:{content:raw},finish_reason:'stop'}]}));}) as typeof fetch);
 assert.equal(calls,1);assert.equal(result.output,raw);assert.equal(request.messages[1].content,question);assert.ok(request.messages[0].content.startsWith(promptSnapshot('v17').text));
 assert.match(request.messages[0].content,/AUTHORITATIVE RESPONSE CONTRACT/);assert.equal(result.metadata.responseContract.contractVersion,'response-contract-v17');assert.equal(result.metadata.contractGuard.checkerVersion,'response-contract-guard-v17');
 assert.equal(request.temperature,0.2);assert.equal(request.reasoning_effort,'low');assert.equal(request.max_completion_tokens,3072);
});
test('invalid or truncated provider answer is never retried or replaced',async()=>{
 for(const body of [{id:'empty',choices:[{message:{content:''},finish_reason:'stop'}]},{id:'cut',choices:[{message:{content:'partial'},finish_reason:'length'}]}]){let calls=0;const result=await providerAnswer({url:'https://mock.invalid/chat',key:'mock',model:'mock'},'v17','Can I return this?',(async()=>{calls++;return new Response(JSON.stringify(body));}) as typeof fetch);assert.equal(calls,1);assert.ok(result.error);assert.equal(result.output,body.choices[0].message.content);}
});
test('v1-v16 prompt texts remain byte-stable against prior evidence',()=>{
 const old=JSON.parse(readFileSync('tests/historical-prompt-hashes.json','utf8'));for(const [version,hash] of Object.entries(old))assert.equal(createHash('sha256').update(promptTemplates[version as keyof typeof promptTemplates]).digest('hex'),hash);
 for(let n=6;n<=16;n++){const date=n===6?'2026-10-15':'2026-10-16',plan=JSON.parse(readFileSync(`docs/evidence/model-v${n}-${date}/plan.json`,'utf8'));assert.equal(promptSnapshot(('v'+n) as keyof typeof promptTemplates).sha256,plan.promptSnapshot.sha256,'v'+n);}
});
