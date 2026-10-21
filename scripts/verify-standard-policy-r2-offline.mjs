import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir='docs/evidence/standard-policy-review-r2-offline-2026-10-21',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(name,value)=>writeFile(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const build=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--pretty','false','--noEmitOnError'],{encoding:'utf8'});
const tests=build.status===0?spawnSync(process.execPath,['--test','--test-isolation=none','dist/tests/standard-policy-review-r2.test.js','dist/tests/semantic-review-wire-v3.test.js'],{encoding:'utf8'}):null;
const before=await json(dir+'/PRESERVATION-BEFORE.json'),changed=[];for(const file of before.files)if(hash(await readFile(file.path))!==file.sha256)changed.push(file.path);
const revision=await json(dir+'/REVISION-MANIFEST.json'),current=[];
for(const file of revision.files)current.push({path:file.path,originalSha256:file.sha256,currentSha256:hash(await readFile(file.path))});
const unexpectedRevisionChanges=current.filter(file=>file.originalSha256!==file.currentSha256&&file.path!=='tests/standard-policy-review-r2.test.ts');
const old=await json('docs/evidence/hybrid-wire-v3-targeted-pairs-2026-10-21/FINAL-RESULT.json');
const initial=await json(dir+'/OFFLINE-TESTS.json');
const result={at:new Date().toISOString(),revision:revision.revision,buildExitCode:build.status,buildOutput:build.stdout+build.stderr,testExitCode:tests?.status??null,testOutput:(tests?.stdout??'')+(tests?.stderr??''),initialOfflineFailurePreserved:initial.exitCode===1,correction:{file:'tests/standard-policy-review-r2.test.ts',before:'all three jointly necessary conditions',after:'all three jointly necessary standard-return conditions',reason:'Literal prompt-content assertion omitted the standard-return words already present in the reviewed definition. No semantic requirement, prompt, schema, fixture or historical judgment changed.'},changedExistingFiles:changed,revisionFiles:current,unexpectedRevisionChanges,oldExperimentStatus:old.status,realRequests:0,semanticValidation:'NOT_PERFORMED',referenceSamples:15,localFakeTransportDispatches:15,shadowOnly:true,reviewer:'calibration_pending'};
await save('FINAL-OFFLINE-VERIFICATION.json',result);
const report=`STANDARD_POLICY r2：规则定义差异与最终离线结果

旧定义偏重“说明未使用、购买后30天内、收据这三项政策条件”。
新定义：三项共同必要条件必须表达完整，并且整段回答没有回答者自己作出的相反政策断言。后文取消、放宽或否定任一条件，STANDARD_POLICY 必须 failed；EXTRA_CLAIMS_AUTHORIZED 可同时失败，但不能替代它。
归属判断：客户原话引用、被明确否定并纠正的错误示例，不自动视为回答者认可；采纳或重申则计入回答者断言。不是看到否定或引号就判违规；归属/纠正范围无法可靠判定时保持 unverifiable。

仅新增独立评审规范/提示修订及候选请求构造器，不改 wire v3、业务政策、合同、95门槛、模型、正式Worker、旧prompt或实验入口。
新请求在系统说明和 applicableRules.STANDARD_POLICY.meaning 中携带新定义。基准 input hash 保留，另记 revision/definition/context/request/body hash。15条请求正文预览仅落盘，未发送。
参考共15条：每个条件均覆盖正确、缺失、后文矛盾、客户引用后纠正、错误示例后明确否定；为项目AI参考，非真实模型结果。

首次检查13/14通过，失败原因仅为新测试的字面断言漏写 standard-return，首次日志保留。修正仅涉及测试字符串，规则定义、请求、参考文本不变。
最终构建退出码 ${build.status}；最终定点测试退出码 ${tests?.status??'未执行'}（完整输出见 FINAL-OFFLINE-VERIFICATION.json）。只验证定义进入实际 transport body 的构造过程、来源/版本隔离、原文保真、wire结构与不重写合成判定，不验证模型理解。
全程15次本地假传输；真实网络/模型/评审请求均为0。未读取API密钥或调用供应商。
${before.files.length}个本轮前既有文件变化${changed.length}个；旧实验继续 ${old.status}，原 STANDARD_POLICY=passed 和其他失败项、原始响应、标签、分数、封口证据原样保留，不重评分或追认通过。

新定义尚未经过真实模型验证。不能将构造测试或旧回答回放作为语义验证通过。
继续 shadowOnly=true、reviewer=calibration_pending。未部署、发布、push或合并；本轮到此停止，不自动安排下一轮。
`;
await writeFile(dir+'/规则定义差异与最终离线结果.txt',report,{flag:'wx'});
if(build.status!==0||tests?.status!==0||changed.length||unexpectedRevisionChanges.length||old.status!=='TARGETED_VALIDATION_FAILED')throw Error('Verification failed; all evidence retained');
console.log(JSON.stringify({buildExitCode:build.status,testExitCode:tests.status,changedExistingFiles:changed.length,unexpectedRevisionChanges:unexpectedRevisionChanges.length,realRequests:0,status:'NEW_DEFINITION_NOT_REAL_MODEL_VALIDATED'}));
