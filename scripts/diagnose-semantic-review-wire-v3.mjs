import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildSemanticReviewInputV1} from '../dist/src/hybrid-evaluation-v1.js';
import {decideReturnV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
import {diagnoseLegacyWireV2ForV3} from '../dist/src/semantic-review-wire-v3.js';

const root=process.cwd();
const oldDir=join(root,'docs/evidence/hybrid-semantic-pilot-v1-2026-10-18');
const rawDir=join(oldDir,'raw-provider');
const outDir=join(root,'docs/evidence/semantic-review-wire-v3-candidate-2026-10-18');
const fixtures=JSON.parse(await readFile(join(root,'tests/semantic-pilot-v1-fixtures.json'),'utf8'));
const targets=['rgp-cobalt-71','rgp-tundra-59','rgp-maple-02'];
const rawFiles=await readdir(rawDir);
const sha=value=>createHash('sha256').update(value).digest('hex');
const reports=[];

for(let sequence=1;sequence<=targets.length;sequence++){
 const sampleId=targets[sequence-1];
 const pair=fixtures.pairs.find(item=>item.allowed.sampleId===sampleId||item.violation.sampleId===sampleId);
 const sample=pair.allowed.sampleId===sampleId?pair.allowed:pair.violation;
 const resultPath=join(oldDir,`result-0${sequence}-${sampleId}.json`);
 const resultText=await readFile(resultPath,'utf8'),oldResult=JSON.parse(resultText);
 const rawName=rawFiles.find(name=>name.startsWith(`${sampleId}-`)&&name.endsWith('.review.txt'));
 if(!rawName)throw new Error(`Missing sealed raw review for ${sampleId}`);
 const rawPath=join(rawDir,rawName),rawText=await readFile(rawPath,'utf8'),raw=JSON.parse(rawText);
 const decision=decideReturnV1(pair.facts),contract=compileResponseContractV17(pair.question,decision,pair.responseMode);
 const input=buildSemanticReviewInputV1({caseId:sampleId,runId:'releaseguard-semantic-pilot-v1-20261018',responseId:sampleId,question:pair.question,originalResponse:sample.response,responseComplete:true,responseMode:pair.responseMode,policy:fixtures.policy,facts:{version:'returns-facts-v1',sourceId:'frozen-project-reference-v1',value:pair.facts},decision,contract});
 const oldReview=oldResult.run?.review;
 const diagnosis=diagnoseLegacyWireV2ForV3(raw,input,{reviewId:`compatibility-diagnosis/${sampleId}`,reviewerIdentity:oldReview?.reviewerIdentity??'model/openai-gpt-oss-120b',modelId:oldReview?.modelId??'openai/gpt-oss-120b',startedAt:oldReview?.startedAt??'2026-10-18T00:00:00.000Z',finishedAt:oldReview?.finishedAt??'2026-10-18T00:00:01.000Z',sourceMetadata:{diagnosticOnly:true,oldResultPath:resultPath,oldResultSha256:sha(resultText),oldRawPath:rawPath,oldRawSha256:sha(rawText)}});
 reports.push({sequence,sampleId,pairId:pair.pairId,oldExperimentStatus:oldResult.run?.status??null,oldProtocolStatus:oldResult.protocol?.status??oldResult.derivedReview?.status??null,oldRawPath:rawPath,oldRawSha256:sha(rawText),oldResultPath:resultPath,oldResultSha256:sha(resultText),candidateDerivationStatus:diagnosis.candidateDerivation.status,legacyMissingReasonMetadata:diagnosis.legacyMissingReasonMetadata,contentConflicts:diagnosis.contentConflicts,separateMissingExplanations:diagnosis.separateMissingExplanations,candidateErrors:diagnosis.candidateDerivation.errors});
}

const report={version:'semantic-review-wire-v3-compatibility-diagnosis',generatedAt:new Date().toISOString(),mode:'offline_diagnostic_only',networkRequests:0,newModelScore:false,oldExperimentStatusPreserved:'SEMANTIC_PILOT_INCOMPLETE',historicalRecordsOverwritten:false,summary:{records:reports.length,candidateDerivationPassed:reports.filter(item=>item.candidateDerivationStatus==='passed').length,legacyMissingReasonValues:reports.reduce((sum,item)=>sum+item.legacyMissingReasonMetadata.length,0),contentConflicts:reports.reduce((sum,item)=>sum+item.contentConflicts.length,0),recordsWithConflicts:reports.filter(item=>item.contentConflicts.length>0).length},records:reports};
const rows=reports.map(item=>`| ${item.sequence} | \`${item.sampleId}\` | ${item.candidateDerivationStatus} | ${item.legacyMissingReasonMetadata.length} | ${item.contentConflicts.length?item.contentConflicts.map(value=>`${value.path}: ${value.code}`).join('<br>'):'none'} |`).join('\n');
const markdown=`# Semantic review wire v3 compatibility diagnosis\n\n- Mode: offline diagnostic only\n- Network/model calls: 0\n- Historical score changed: no\n- Historical pilot state: \`SEMANTIC_PILOT_INCOMPLETE\` (unchanged)\n- Records diagnosed: ${reports.length}\n- Candidate derivations structurally/evidence valid: ${report.summary.candidateDerivationPassed}/${reports.length}\n- Preserved legacy \`missingReason\` values: ${report.summary.legacyMissingReasonValues}\n- Explicit legacy content conflicts: ${report.summary.contentConflicts}\n\n| # | Saved review | v3 candidate derivation | preserved missingReason | conflict |\n|---:|---|---|---:|---|\n${rows}\n\nThe v3 candidate result is not a new model score. It is a read-only adaptation of sealed v2 output. Every legacy \`missingReason\` value remains in compatibility metadata. The Maple record contains evidence and a separate missing explanation for the same rule; that conflict is reported rather than erased.\n`;
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'COMPATIBILITY-DIAGNOSIS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(join(outDir,'COMPATIBILITY-DIAGNOSIS.md'),markdown,{flag:'wx'});
console.log(JSON.stringify(report.summary));
