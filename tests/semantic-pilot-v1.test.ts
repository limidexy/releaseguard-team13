import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildSemanticReviewInputV1,runDeterministicChecksV1,type HybridEnvelopeV1} from '../src/hybrid-evaluation-v1.js';
import {buildGroqSemanticReviewHttpBodyV1} from '../src/groq-semantic-review-transport-v1.js';
import {buildModelReviewRequestV1} from '../src/semantic-review-sources-v1.js';
import {decideReturnV1,type ReturnFacts} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';

type Sample={sampleId:string;response:string;referenceEvidence:string;rationale:string};
type Pair={pairId:string;scenario:string;question:string;responseMode:'plain'|'json';facts:ReturnFacts;criticalRuleId:string;mutation:{from:string;to:string};allowed:Sample;violation:Sample};
type Fixtures={version:string;annotationSource:string;labelsFrozenBeforeReviewerExecution:boolean;labelsSentToReviewer:boolean;policy:{version:string;text:string};pairs:Pair[];executionOrder:string[]};

const fixtures=JSON.parse(await readFile(new URL('../../tests/semantic-pilot-v1-fixtures.json',import.meta.url),'utf8')) as Fixtures;
function envelope(pair:Pair,sample:Sample):HybridEnvelopeV1{
 const decision=decideReturnV1(pair.facts),contract=compileResponseContractV17(pair.question,decision,pair.responseMode);
 return {caseId:sample.sampleId,runId:'semantic-pilot-v1-offline',responseId:sample.sampleId,question:pair.question,originalResponse:sample.response,responseComplete:true,responseMode:pair.responseMode,policy:fixtures.policy,facts:{version:'returns-facts-v1',sourceId:'frozen-project-reference-v1',value:pair.facts},decision,contract};
}

test('pilot freezes ten one-meaning pairs, ten allowed and ten violating samples in a shuffled opaque order',()=>{
 assert.equal(fixtures.pairs.length,10);assert.equal(fixtures.labelsFrozenBeforeReviewerExecution,true);assert.equal(fixtures.labelsSentToReviewer,false);assert.match(fixtures.annotationSource,/not a verified human blind review/i);
 const samples=fixtures.pairs.flatMap(pair=>[pair.allowed,pair.violation]),ids=samples.map(sample=>sample.sampleId);
 assert.equal(samples.length,20);assert.equal(new Set(ids).size,20);assert.equal(fixtures.executionOrder.length,20);assert.deepEqual(new Set(fixtures.executionOrder),new Set(ids));
 for(const pair of fixtures.pairs){assert.notEqual(pair.allowed.response,pair.violation.response);assert.ok(pair.allowed.response.includes(pair.mutation.from));assert.equal(pair.allowed.response.replace(pair.mutation.from,pair.mutation.to),pair.violation.response);assert.ok(pair.allowed.response.includes(pair.allowed.referenceEvidence));assert.ok(pair.violation.response.includes(pair.violation.referenceEvidence));}
});

test('all twenty frozen responses pass deterministic binding and format checks before semantic review',()=>{
 for(const pair of fixtures.pairs)for(const sample of [pair.allowed,pair.violation]){const env=envelope(pair,sample),input=buildSemanticReviewInputV1(env),deterministic=runDeterministicChecksV1(env,input);assert.equal(env.contract.compilationStatus,'ready',`${sample.sampleId} contract`);assert.equal(deterministic.status,'passed',`${sample.sampleId}: ${deterministic.checks.filter(check=>check.status==='failed').map(check=>check.checkId).join(',')}`);assert.ok(input.applicableRules.some(rule=>rule.ruleId===pair.criticalRuleId),`${sample.sampleId}: critical rule must be applicable`);}
});

test('provider requests contain no labels, pair identities, reference rationales or expected outcomes',()=>{
 const config={apiKey:'not-serialized',modelId:'openai/gpt-oss-120b' as const,temperature:0 as const,maxOutputTokens:2400,reasoningEffort:'low' as const,requestTimeoutMs:60000};
 for(const pair of fixtures.pairs)for(const sample of [pair.allowed,pair.violation]){const input=buildSemanticReviewInputV1(envelope(pair,sample)),request=buildModelReviewRequestV1(input),body=buildGroqSemanticReviewHttpBodyV1(request,config),serialized=JSON.stringify(body);for(const forbidden of ['expectedAllowed','criticalRuleId','referenceEvidence','rationale','pairId',pair.pairId])assert.equal(serialized.includes(forbidden),false,`${sample.sampleId}: leaked ${forbidden}`);assert.equal(serialized.includes(config.apiKey),false);}
});

test('new pilot responses do not exactly reuse the previous held-out fixture answers',async()=>{
 const old=JSON.parse(await readFile(new URL('../../tests/evaluator-next-v1-holdout-v2-fixtures.json',import.meta.url),'utf8')) as {fixtures:{response:string}[]},oldResponses=new Set(old.fixtures.map(item=>item.response));
 for(const pair of fixtures.pairs)for(const sample of [pair.allowed,pair.violation])assert.equal(oldResponses.has(sample.response),false,sample.sampleId);
});
