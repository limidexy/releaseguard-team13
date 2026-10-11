// Offline derivation only: no provider or platform network calls, no record rewriting.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {evaluate,caseSchema} from '../dist/src/domain.js';
import {revisedReturnsSuite,returnsEvaluatorVersion} from '../dist/src/returns-policy.js';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/rescore-retained.mjs retained-real-report.json');
const raw=await readFile(file),source=JSON.parse(raw);
if(source.source!=='real'||!Array.isArray(source.runs)||source.runs.length!==2)throw Error('Expected retained two-prompt real report');
const suite=revisedReturnsSuite({name:'Retained comparison',description:'Offline re-score',cases:source.cases,policy:source.policy});
const cases=suite.cases.map(c=>caseSchema.parse(c));
const report={at:new Date().toISOString(),kind:'OFFLINE_RESCORING',newProviderCalls:0,sourceFile:file,sourceSha256:createHash('sha256').update(raw).digest('hex'),originalEvaluatorVersion:source.evaluatorVersion,evaluatorVersion:returnsEvaluatorVersion,evaluatorCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),evaluatorSourceSha256:createHash('sha256').update(await readFile('src/returns-policy.ts')).digest('hex'),policy:suite.policy,runs:source.runs.map(j=>{
 const outputs=j.result.results.map(r=>({caseId:r.caseId,...(typeof r.output==='string'?{output:r.output}:{}),...(r.latencyMs!==null?{latencyMs:r.latencyMs}:{}),...(r.status==='error'?{error:r.reason}:{})}));
 const result=evaluate(cases,suite.policy,outputs);
 return{originalJobId:j.id,promptVersion:j.input.promptVersion,originalScore:j.result.score,originalGate:j.result.gate,result,changedCases:result.results.flatMap(r=>{const old=j.result.results.find(o=>o.caseId===r.caseId);return old.status!==r.status||old.reason!==r.reason?[{caseId:r.caseId,from:old.status,to:r.status,oldReason:old.reason,newReason:r.reason}]:[]})};
}),limitation:'Evaluator v2.1 was refined after inspecting these answers. This is an explanatory re-score, NOT a new/blind validation, NOT new provider calls and NOT human approval. v2.0 jobs and raw reports remain unchanged. Independent holdout and human review remain pending.'};
await mkdir('evidence/current',{recursive:true});const out='evidence/current/rescore-retained-'+Date.now()+'.json';await writeFile(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(out);console.log(JSON.stringify(report.runs.map(r=>({promptVersion:r.promptVersion,originalScore:r.originalScore,rescored:r.result.score,gate:r.result.gate,changed:r.changedCases}))));
