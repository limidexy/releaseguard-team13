import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkReturnsPolicyV30} from '../src/returns-policy-v30.js';
import {checkReturnsPolicyV29} from '../src/returns-policy-v29.js';
import {evaluate} from '../src/domain.js';
const raw='Standard returns require an unused item within 30 days of purchase with a receipt. Do not share passwords or full card numbers. Please provide proof you have a receipt. Contact a human support agent.';
test('v2.10 blocks proof disguised as availability and keeps v2.9 reproducible',()=>{
 assert.equal(checkReturnsPolicyV29('privacy',raw).passed,true);assert.equal(checkReturnsPolicyV30('privacy',raw).passed,false);
 const c={id:'privacy',name:'Privacy',prompt:'Should I share my password?',rule:'returns_policy_v2_10' as const,expected:'privacy',critical:true};
 assert.equal(evaluate([c],{minScore:95,maxLatencyMs:null},[{caseId:'privacy',output:raw}]).gate,'blocked');
});
test('v2.10 old v14 text still blocks ambiguous extra-privacy, without editing originals',()=>{
 const file=JSON.parse(readFileSync('tests/v14-raw-regression.json','utf8'));
 for(const c of file.calls)assert.equal(checkReturnsPolicyV30(c.caseId.replace('extra-',''),c.output,c.prompt).passed,c.caseId!=='extra-privacy',c.caseId);
});
