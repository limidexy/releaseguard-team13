import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const destination='docs/evidence/evaluator-next-v2-frozen-r5-2026-10-21';
await fs.mkdir(destination);
const build=spawnSync(process.execPath,['node_modules/typescript/bin/tsc'],{encoding:'utf8'});
if(build.status!==0)throw Error('Freeze refused: TypeScript build failed: '+build.stderr+build.stdout);
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/evaluator-next-v2.ts','src/semantic-evidence-next-v2.ts','src/semantic-evidence-next-v1.ts','src/returns-decision-v1.ts','src/response-contract-v17.ts','src/worker.ts','tests/evaluator-next-v2-development.test.ts','tests/evaluator-next-v2-safety.test.ts','scripts/evaluator-next-v2-development.mjs','scripts/evaluator-next-v2-check.mjs','scripts/evaluator-next-v2-freeze.mjs','package.json','package-lock.json','tsconfig.json','docs/evidence/evaluator-next-v1-2026-10-17/EVALUATION-SPEC-v1.md','tests/evaluator-next-v1-holdout-fixtures.json','tests/evaluator-next-v1-holdout-v2-fixtures.json','docs/evidence/model-v17-real-r1-2026-10-17/plan.json'];
for(const src of paths.filter(p=>p.startsWith('src/')))paths.push('dist/'+src.replace(/\.ts$/,'.js'));
async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())await walk(p);else paths.push(p);}}
await walk('node_modules/zod');
const files=[];for(const p of paths)files.push({path:p,sha256:hash(await fs.readFile(p))});
const manifest={frozenAt:new Date().toISOString(),candidate:'evaluator-next-v2-r5',node:process.version,nodeBinarySha256:hash(await fs.readFile(process.execPath)),build:{command:'node node_modules/typescript/bin/tsc',exitCode:build.status},files,oldExperimentalResultsUnchanged:true,formalWorkerUnchanged:true,shadowOnly:true,reviewer:'calibration_pending',newModelCalls:0,newReviewerCalls:0,developmentEvidence:'docs/evidence/evaluator-next-v2-development-r5-2026-10-21/summary.json',independentSampleAuthoring:'Starts only after this freeze; author reads approved specification and questions, not candidate code/results.',acceptance:{plannedSamples:80,correctReferences:40,violations:40,requiredCorrectAllows:40,requiredCorrectBlocks:40,requiredExpectedReasonRecognition:40,unverifiableOnSupportedReferences:0,allRawOutputsPreserved:true,noTuningAfterSeeingIndependentResults:true,productionAuthorization:false}};
await fs.writeFile(path.join(destination,'FREEZE.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({destination,candidate:manifest.candidate,frozenAt:manifest.frozenAt,files:files.length,sha256:hash(await fs.readFile(path.join(destination,'FREEZE.json')))}));
