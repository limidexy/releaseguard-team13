import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir='docs/evidence/standard-policy-review-r2-offline-2026-10-21';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(name,value)=>writeFile(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
if(process.argv[2]==='--snapshot'){
 const files=[];async function scan(root){for(const entry of await readdir(root,{withFileTypes:true})){const path=root+'/'+entry.name;if(path===dir)continue;if(entry.isDirectory())await scan(path);else if(entry.isFile())files.push({path,sha256:hash(await readFile(path))});}}
 for(const root of ['src','tests','scripts','docs/evidence'])await scan(root);
 await mkdir(dir);await save('PRESERVATION-BEFORE.json',{at:new Date().toISOString(),files});console.log(JSON.stringify({preservedFiles:files.length,dir}));process.exit(0);
}
if(process.argv[2]!=='--check')throw Error('Only offline --snapshot or --check supported');
const build=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--pretty','false','--noEmitOnError'],{encoding:'utf8'});
await save('BUILD.json',{exitCode:build.status,output:build.stdout+build.stderr});if(build.status!==0)throw Error('Build failed; no model calls');
const run=spawnSync(process.execPath,['--test','--test-isolation=none','dist/tests/standard-policy-review-r2.test.js','dist/tests/semantic-review-wire-v3.test.js'],{encoding:'utf8'});
await save('OFFLINE-TESTS.json',{exitCode:run.status,output:run.stdout+run.stderr,scope:'Request construction, attribution/reference coverage, original text, version isolation, unchanged wire, immutable synthetic judgments. Not model semantic validation.',realRequests:0});
const {buildStandardPolicyReviewR2,STANDARD_POLICY_REVIEW_REVISION_R2,STANDARD_POLICY_REVIEW_MEANING_R2,STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2}=await import('../dist/src/standard-policy-review-r2.js');
const {bindAnswerSampleV1,boundAnswerViewsV1}=await import('../dist/src/answer-evaluation-binding-v1.js');
const sourcePath='tests/standard-policy-review-r2-fixtures.json',fixtures=await json(sourcePath);
const original=(await json('docs/evidence/route-contract-alignment-2026-10-21/TARGETED-PAIRS-BOUND.json')).samples[0];
const config={apiKey:'offline-not-a-credential',modelId:'openai/gpt-oss-120b',temperature:0,maxOutputTokens:2400,reasoningEffort:'low',requestTimeoutMs:60000};
const referenceLabels=[],bound=[];
for(const [index,fixture] of fixtures.samples.entries()){
 const id='r2-'+String(index+1).padStart(3,'0'),envelope={...original.envelope,caseId:id,responseId:id,runId:'standard-policy-r2-offline-20261021',originalResponse:fixture.answer};
 const sample=bindAnswerSampleV1(envelope,{questionVersion:'standard-policy-r2-reference-question',answerVersion:'standard-policy-r2-ai-reference',answerKind:'ai_reference',sourceArtifact:sourcePath,sourceArtifactSha256:hash(await readFile(sourcePath))});
 const input=boundAnswerViewsV1(sample).reviewerInput,candidate=buildStandardPolicyReviewR2(input,config);
 await save('request-preview-'+id+'.json',{sent:false,reviewRevision:candidate.revision,baseReviewInputHash:candidate.baseReviewInputHash,reviewDefinitionHash:candidate.definitionHash,requestHash:candidate.requestHash,providerRequestHash:candidate.providerRequestHash,providerRequest:candidate.providerRequest});
 bound.push({sample,reviewRevision:candidate.revision,definitionHash:candidate.definitionHash,providerRequestHash:candidate.providerRequestHash});
 referenceLabels.push({anonymousId:id,fixtureId:fixture.id,condition:fixture.condition,category:fixture.category,attribution:fixture.attribution,expectedStandardPolicy:fixture.expectedStandardPolicy,reason:fixture.reason,bindingHash:sample.bindingHash,status:'REFERENCE_ONLY_NOT_MODEL_VALIDATED'});
}
await save('BOUND-REFERENCES.json',{status:'NOT_REAL_MODEL_VALIDATED',samples:bound});
await save('REFERENCE-LABELS-SEPARATE.json',{source:fixtures.annotationSource,labels:referenceLabels});
const before=await json(dir+'/PRESERVATION-BEFORE.json'),changed=[];for(const file of before.files)if(hash(await readFile(file.path))!==file.sha256)changed.push(file.path);
const old=await json('docs/evidence/hybrid-wire-v3-targeted-pairs-2026-10-21/FINAL-RESULT.json'),record=await json('docs/evidence/hybrid-wire-v3-targeted-pairs-2026-10-21/result-10.json');
const unchangedFailedHistory=old.status==='TARGETED_VALIDATION_FAILED'&&record.derived.ruleResults.find(row=>row.ruleId==='STANDARD_POLICY').status==='passed';
const files=[];for(const path of ['src/standard-policy-review-r2.ts','tests/standard-policy-review-r2.test.ts',sourcePath,'dist/src/standard-policy-review-r2.js','src/groq-semantic-review-transport-v2.ts','src/semantic-review-wire-v3.ts','src/worker.ts','scripts/standard-policy-r2-offline.mjs'])files.push({path,sha256:hash(await readFile(path))});
await save('REVISION-MANIFEST.json',{revision:STANDARD_POLICY_REVIEW_REVISION_R2,meaning:STANDARD_POLICY_REVIEW_MEANING_R2,instructions:STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2,files,realRequests:0,schemaVersion:'wire v3 unchanged',baseReviewPromptVersion:'semantic-review-prompt-v1 unchanged; this refinement has a separate revision/hash, not a renamed historical prompt',status:'NOT_REAL_MODEL_VALIDATED'});
await save('OFFLINE-RESULT.json',{at:new Date().toISOString(),revision:STANDARD_POLICY_REVIEW_REVISION_R2,buildExitCode:build.status,testExitCode:run.status,referenceSamples:fixtures.samples.length,referenceCoverage:'Each of unused/30-day/receipt: correct, missing, contradictory assertion, customer quote corrected, erroneous example explicitly refuted.',preservedExistingFiles:before.files.length,changedExistingFiles:changed,unchangedFailedHistory,realRequests:0,modelSemanticValidation:'NOT_PERFORMED',shadowOnly:true,reviewer:'calibration_pending'});
const report=`STANDARD_POLICY 评审定义修订 r2（仅离线）

旧定义：State that standard returns require an unused item within 30 days of purchase with a receipt.
新定义：${STANDARD_POLICY_REVIEW_MEANING_R2}

通过必须同时满足：正确表达未使用、购买后不超过30天、持有收据三个共同必要条件；全文不存在回答者自己作出的相反政策断言。
后文取消、放宽或否定任一条件时，STANDARD_POLICY 必须 failed。EXTRA_CLAIMS_AUTHORIZED 可同时失败，不能替代这一逐规则结论。
区分回答者的政策断言、仅归属于客户的引用、已明确否定并纠正的错误示例。否定句或引用本身不构成违规；引述若被回答者采纳或重申仍属回答者断言。归属或纠正范围无法可靠判断时保持 unverifiable，不强行通过。

实现边界：仅新增独立候选请求构造器。它在现有 wire v3 请求中加入评审修订说明、细化 STANDARD_POLICY 的 applicableRules meaning，不改变绑定原始合同、facts、decision、业务政策、原文或95门槛。
基准 prompt version 不改；新定义独立记录 revision、definition hash、base input hash 及完整 request/body hash，不能与旧请求复用结果。旧封口入口与正式 Worker 没有接入该候选。
模型的 status/reason/quote 不由程序重写；新模块没有输出语义分数或规则判定的能力。

离线参考 ${fixtures.samples.length} 条：三条件各覆盖正确、缺失、后文矛盾、客户引用并纠正、错误示例并否定。标签为项目AI参考，不是模型成绩或真人盲审。
请求正文预览分别保存，标签单独保存。离线测试覆盖现有 transport 实际构造并交给注入的本地假传输函数的 body，而不只检查说明文档；假传输次数不等于真实请求。
构建退出码 ${build.status}；定点测试退出码 ${run.status}，详见 OFFLINE-TESTS.json。未运行全仓库测试。
保全清单 ${before.files.length} 个既有文件，变化 ${changed.length} 个。原 TARGETED_VALIDATION_FAILED 与第10条 STANDARD_POLICY=passed 原样保留；其他失败项、引用、成绩、封口记录均未重算或追认。

新定义尚未经过真实模型验证。未使用构造测试或历史回答回放声称其理解能力已通过。
本轮真实请求=0；未读取密钥、核验云账户或启动供应商调用。未部署、发布、push或合并。保持 shadowOnly=true、calibration_pending。
完成后停止，不自动安排下一轮。
`;
await writeFile(dir+'/规则定义差异与离线结果.txt',report,{flag:'wx'});
if(run.status!==0||changed.length||!unchangedFailedHistory)throw Error('Offline check or preservation failed; saved evidence retained');
console.log(JSON.stringify({dir,buildExitCode:build.status,testExitCode:run.status,referenceSamples:fixtures.samples.length,changedExistingFiles:changed.length,realRequests:0,status:'NOT_REAL_MODEL_VALIDATED'}));
