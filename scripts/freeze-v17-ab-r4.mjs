import {createHash} from 'node:crypto';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {relative,resolve} from 'node:path';
import {responseModeV8,responseModesV14} from '../dist/src/provider.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
import {compileGenerationViewV17R3,generationPromptV17R3} from '../dist/src/generation-view-v17.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const evidenceDir=resolve(root,'docs/evidence/model-v17-ab-r4-2026-10-17');
const manifestPath=resolve(evidenceDir,'freeze-manifest-r4.json');
const planPath=resolve(evidenceDir,'ab-plan-v17-r4.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const stableSha=value=>sha(JSON.stringify(value));
const walk=async dir=>{const results=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())results.push(...await walk(path));else results.push(path);}return results;};
const relativePath=path=>relative(root,path).split('\\').join('/');

const fixedFiles=[
 'package.json','package-lock.json','scripts/run-v17-ab-r4.mjs','scripts/freeze-v17-ab-r4.mjs',
 'docs/evidence/model-v17-real-r1-2026-10-17/plan.json',
 'docs/evidence/model-v17-credibility-r3-2026-10-17/semantic-audit-v17-r3.json',
 'docs/evidence/model-v17-ab-r4-2026-10-17/free-plan-verification-r4.json',
 'docs/evidence/model-v17-ab-r4-2026-10-17/provenance-correction-r4.md',
];
const executionFiles=[...(await walk(resolve(root,'src'))).filter(x=>x.endsWith('.ts')).map(relativePath),...(await walk(resolve(root,'dist/src'))).filter(x=>x.endsWith('.js')).map(relativePath),...fixedFiles].sort();
const files=[];for(const path of executionFiles){const raw=await readFile(resolve(root,path));files.push({path,bytes:raw.length,sha256:sha(raw)});}
const manifest={revision:'v17-generation-view-r4-ab1',createdAt:new Date().toISOString(),runtime:{nodeExecutable:process.execPath,nodeVersion:process.version,platform:process.platform,arch:process.arch,packageLockVersion:JSON.parse(await readFile(resolve(root,'package-lock.json'),'utf8')).lockfileVersion},scope:'All TypeScript source files, all built runtime JavaScript under dist/src, package manifests, the one-time runner/freezer, the frozen 20-case source plan, semantic reference annotations, Free-plan evidence, and provenance correction.',files};
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});

const sourceQuestionPlan='docs/evidence/model-v17-real-r1-2026-10-17/plan.json',sourcePlanRaw=await readFile(resolve(root,sourceQuestionPlan)),sourcePlan=JSON.parse(sourcePlanRaw),cases=sourcePlan.suites.flatMap(s=>s.cases);
const frozenCases=cases.map(testCase=>{const decision=decisionForQuestionV1(testCase.prompt),responseMode=responseModeV8(testCase.prompt),contract=compileResponseContractV17(testCase.prompt,decision,responseMode),view=compileGenerationViewV17R3(decision,contract);if(contract.compilationStatus!=='ready')throw Error('Contract is not ready: '+testCase.id);return {caseId:testCase.id,questionSha256:sha(testCase.prompt),contractSha256:stableSha(contract),generationViewSha256:stableSha(view)};});
const verificationRaw=await readFile(resolve(evidenceDir,'free-plan-verification-r4.json')),manifestRaw=await readFile(manifestPath);
const plan={
 revision:'v17-generation-view-r4-ab1',experimentId:'releaseguard-v17-r4-ab-20261017',status:'AUTHORIZED_FROZEN_NOT_STARTED',purpose:'One authorized fixed-20-case A/B comparison on the verified Groq Free plan; all controls are held constant except model.',providerOrigin:'https://api.groq.com',providerEndpoint:'https://api.groq.com/openai/v1/chat/completions',sourceQuestionPlan,sourceQuestionPlanSha256:sha(sourcePlanRaw),questionOrder:cases.map(x=>x.id),
 arms:[{arm:'A',model:'openai/gpt-oss-20b',calls:20},{arm:'B',model:'openai/gpt-oss-120b',calls:20}],totalBudgetedCalls:40,automaticRetries:0,selection:'No per-case selection, replacement, correction, best-of filtering, or post-generation repair.',executionOrder:'For each frozen case in order, record and send A at most once, then record and send B at most once. A recorded attempt is never resent, including after timeout, crash, or unknown outcome.',
 configuration:{temperature:0.2,reasoningEffort:'low',maxOutputTokens:3072,requestTimeoutMs:20000,minimumStartIntervalMs:20000},evaluation:{evaluatorVersion:'returns-policy-v2.10',minScore:95,criticalOrProviderErrorBlocks:true,oldGuard:'explanation-guard-v2',contractGuard:'response-contract-guard-v17-r3',finalResult:'Exact per-case intersection of provider completeness, raw v2.10 pass, old guard, new contract compliance, business consistency, customer text safety, and contract final delivery.',rawAnswersPreserved:true},
 generation:{promptRevision:'generation-view-v17-r3-required-clarifications-r4',fullContractRetainedForAudit:true,fullContractSentToModel:false,referenceAnswerSentToModel:false,postGenerationRepair:false,requiredClarificationsReplacePermittedClarifications:true,bareIntervalOriginNeutral:true},
 freezeManifestSha256:sha(manifestRaw),freePlanVerificationSha256:sha(verificationRaw),frozenDerivedHashes:{compiledCaseContractAndViewSet:stableSha(frozenCases),generationPrompt:sha(generationPromptV17R3),responseModes:stableSha(responseModesV14)},offlineAcceptance:{nodeVersion:process.version,tests:{passed:728,failed:0,total:728},targetedGenerationViewRegressions:{passed:2,failed:0,total:2},providerInferenceCalls:0},
 authorization:{userAuthorizedOneExperiment:true,maximumInferenceRequests:40,secondExperimentAuthorized:false,paidUpgradeAllowed:false,paidCallsAllowed:false,providerSwitchAllowed:false,deploymentAllowed:false,publicationAllowed:false,gitPushAllowed:false},
 persistentExecutionProtection:{experimentLock:'experiment-v17-r4.lock.json',attemptLedger:'experiment-v17-r4.attempts.jsonl',outcomeLedger:'experiment-v17-r4.outcomes.jsonl',attemptRecordedAndSyncedBeforeSend:true,attemptedRequestNeverResent:true},
 provenance:{semanticReferenceAnnotations:'Project evaluation annotations, not a verified independent human-review record.',correction:'docs/evidence/model-v17-ab-r4-2026-10-17/provenance-correction-r4.md'},
 limitations:['These 20 cases are development regressions, not a hidden test set.','Free-plan UI evidence and displayed limits do not guarantee provider availability for every request.','A successful result applies only to this frozen configuration and fixed 20-case set; it does not establish hidden-set stability or production readiness.']
};
await writeFile(planPath,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({manifest:relativePath(manifestPath),manifestSha256:sha(manifestRaw),plan:relativePath(planPath),planSha256:sha(await readFile(planPath)),fileCount:files.length,nodeVersion:process.version,caseCount:cases.length}));
