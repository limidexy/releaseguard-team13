import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { promptSnapshot, providerAnswer } from '../src/provider.js';
import { jobSchema } from '../src/domain.js';
test('historical v10 snapshot remains reproducible after adding v11', () => {
  assert.deepEqual(promptSnapshot('v10'), JSON.parse(readFileSync('tests/frozen-v27-v10.json','utf8')).v10);
});
test('v11 accepts predecessor link and unknown future version stays rejected', () => {
  const input = {appId:'00000000-0000-4000-8000-000000000001',suiteId:'00000000-0000-4000-8000-000000000002',candidate:'v11 candidate',commitRef:'local-v11',source:'real',previousJobId:'00000000-0000-4000-8000-000000000003'};
  assert.equal(jobSchema.parse({...input,promptVersion:'v11'}).previousJobId,input.previousJobId);
  assert.equal(jobSchema.safeParse({...input,promptVersion:'v18'}).success,false);
});
test('v11 adapter retains provider answers and fail-closed truncation with same budget', async () => {
  for (const finish of ['stop','length']) {
    const answer = await providerAnswer({url:'https://provider.invalid/chat',key:'mock-only',model:'mock'},'v11','Can you explain the return policy?',(async (_url:any,init:any)=>{
      const body=JSON.parse(init.body);
      assert.equal(body.max_completion_tokens,3072); assert.equal(body.temperature,0.2); assert.equal(body.reasoning_effort,'low');
      assert.ok(body.messages[0].content.startsWith(promptSnapshot('v11').text));
      return new Response(JSON.stringify({id:'mock',model:'mock',choices:[{message:{content:'Unaltered provider text.'},finish_reason:finish}]}));
    }) as typeof fetch);
    assert.equal(answer.output,'Unaltered provider text.');
    assert.equal(Boolean(answer.error),finish==='length');
  }
});
