// Complete original three-database logical backup/restore consumer, inactive.
// MD5 public-row fingerprints are equality diagnostics, not signatures, schema
// proof or a continuously held source snapshot. Failure/unknown keeps all3rows.
import {isDeepStrictEqual as same} from 'node:util';
import {validateEvidenceConfiguration} from './gcp-evidence-core.mjs';
import {backupDatabases,backupScratch,backupMarker} from './backup-sql.mjs';
import {sha256,strictComparisonJSON} from './comparison-files.mjs';
const deny=()=>{throw Error('Backup protocol unconfirmed');};
const exact=(x,keys)=>{if(!x||Object.getPrototypeOf(x)!==Object.prototype||Object.keys(x).sort().join(',')!==[...keys].sort().join(','))deny();};
export function validateBackup(c){
 exact(c,['allowCloudBackupRestore','runId','sourceCommit','deadlineMs','cloud','target']);
 if(c.allowCloudBackupRestore!==true||!/^[a-f0-9]{40}$/.test(c.sourceCommit??'')||!Number.isInteger(c.deadlineMs)||c.deadlineMs<360001||c.deadlineMs>1200000)deny();
 // Reuse only the selected-cloud identity schema; backup deadlines are above.
 validateEvidenceConfiguration({mode:'collect-readonly',runId:c.runId,deadlineMs:1000,sources:{},cloud:c.cloud},true);
 const t=c.target;exact(t,['acknowledgement','podName','podUID','containerName','containerID','imageDigest','nodeName','systemIdentifier','serverVersionNum','postmasterEpoch','databaseOIDs']);
 if(t.acknowledgement!=='I_AUTHORIZE_TRUSTED_SOURCE_THREE_DB_SCRATCH_RESTORE_AND_OWNED_CLEANUP'||t.podName!=='postgres-0'||t.containerName!=='postgres'||!/^[-A-Za-z0-9]{1,100}$/.test(t.podUID??'')||
  !/^containerd:\/\/[a-zA-Z0-9-]{1,100}$/.test(t.containerID??'')||!/^sha256:[a-f0-9]{64}$/.test(t.imageDigest??'')||!/^[-a-z0-9]{1,63}$/.test(t.nodeName??'')||
  !/^\d{1,22}$/.test(t.systemIdentifier??'')||!Number.isInteger(t.serverVersionNum)||t.serverVersionNum<170000||t.serverVersionNum>=180000||!/^\d{1,15}\.\d{6}$/.test(t.postmasterEpoch??''))deny();
 exact(t.databaseOIDs,backupDatabases);if(Object.values(t.databaseOIDs).some(x=>!Number.isInteger(x)||x<16384||x>4294967295)||new Set(Object.values(t.databaseOIDs)).size!==3)deny();
 return structuredClone(c);
}
export async function runBackup(input,io){
 let c,reserved=false,sequence=0,halt=false,last=-Infinity,phase='configuration';const errors=[],rows=backupDatabases.map(database=>({database,state:'not_attempted',scratch:null,creation:{state:'not_sent'},restore:{state:'not_sent'},cleanup:{state:'not_needed'}}));
 const check=clean=>{const n=io.now();if(!Number.isFinite(n)||n<last||io.remaining(clean)<=0||!clean&&(halt||io.signal?.aborted))deny();last=n;};
 const fail=code=>{halt=true;throw Error(code);};
 async function call(kind,row,extra={},clean=false,onEnter=()=>{}){
  check(clean);const n=String(++sequence).padStart(6,'0'),name=(clean?'cleanup-':'')+'operation-'+n;
  const {input:binaryInput,...described}=extra;
  await io.json(name+'-intent.json',{phase,kind,database:row?.database??null,scratch:row?.scratch??null,...described,state:'intent',noRetry:true},clean);check(clean);onEnter();
  let r;try{r=await io.command(kind,row,extra,clean);}catch{r={status:null,error:{code:'BOUNDARY_THROWN_OUTCOME_UNKNOWN'},stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),spawnEntered:true,outputTruncated:false};}
  if(!Buffer.isBuffer(r.stdout)||!Buffer.isBuffer(r.stderr))fail('binary_boundary_invalid');
  const stdoutSHA256=sha256(r.stdout),stderrSHA256=sha256(r.stderr);await io.put(name+'-stdout.bin',r.stdout,clean);await io.put(name+'-stderr.bin',r.stderr,clean);
  await io.json(name+'-observed.json',{kind,status:r.status,signal:r.signal??null,errorCode:r.error?.code??null,spawnEntered:r.spawnEntered,outputTruncated:r.outputTruncated===true,stdoutBytes:r.stdout.length,stderrBytes:r.stderr.length,stdoutSHA256,stderrSHA256,noRetry:true},clean);
  const ok=r.status===0&&!r.signal&&!r.error&&!r.outputTruncated&&io.remaining(clean)>0&&!(!clean&&io.signal?.aborted);
  let value=null;if(ok&&kind!=='dump'&&kind!=='restore')try{value=strictComparisonJSON(r.stdout);}catch{if(!clean)halt=true;}
  return {ok:ok&&(kind==='dump'||kind==='restore'||value!==null),value,bytes:r.stdout,stdoutSHA256,spawnEntered:r.spawnEntered,evidencePrefix:name};
 }
 const owned=(v,row)=>v?.exists===true&&v.owned===true&&Number.isInteger(v.oid)&&v.oid>=16384&&v.oid<=4294967295&&v.owner==='rg_admin'&&v.marker===backupMarker(c,row.database);
 async function fingerprint(row,restored=false){
  const prefix=restored?'restored':'source',list=await call(prefix+'-tables',row,{scratchOID:row.scratchOID??null});
  if(!list.ok||!Array.isArray(list.value)||list.value.length>1000||new Set(list.value).size!==list.value.length||list.value.some(x=>typeof x!=='string'||!/^[_a-z]+$/.test(x)||x.length>63))fail('table_inventory_unconfirmed');
  const result=[];for(const table of list.value){const r=await call(prefix+'-table',row,{scratchOID:row.scratchOID??null,table});if(!r.ok||r.value.table!==table||!/^\d+$/.test(r.value.count??'')||!(/^[a-f0-9]{32}$/.test(r.value.hash??'')||r.value.hash==='empty'))fail('table_fingerprint_unconfirmed');result.push(r.value);}return result;
 }
 async function cleanup(row){
  if(row.creation.state==='not_sent')return;row.cleanup={state:'unconfirmed',dropAttempts:0};
  try{
   const observed=await call('owned',row,{},true);if(!observed.ok)deny();
   if(observed.value.exists===false&&observed.value.owned===false&&observed.value.oid===null&&observed.value.marker===null&&observed.value.owner===null){row.cleanup={state:'absent_observed',dropAttempts:0};return;}
   if(!owned(observed.value,row)||row.scratchOID!==undefined&&observed.value.oid!==row.scratchOID)deny();row.scratchOID=observed.value.oid;
   const r=await call('drop',row,{scratchOID:row.scratchOID},true,()=>{row.cleanup.dropAttempts=1;});row.cleanup={state:r.ok&&r.value?.absent===true?'dropped_observed':'drop_failed_or_unknown_no_retry',dropAttempts:1};
  }catch{row.cleanup={...row.cleanup,state:row.cleanup.dropAttempts?'drop_failed_or_unknown_no_retry':'ownership_unconfirmed_preserved'};}
 }
 try{
  c=validateBackup(input);phase='reservation';await io.reserve(c);reserved=true;check(false);
  phase='selected-target';await io.preflight(c);check(false);const i=await call('identity');
  if(!i.ok||!same(i.value,{systemIdentifier:c.target.systemIdentifier,serverVersionNum:c.target.serverVersionNum,postmasterEpoch:c.target.postmasterEpoch,role:'rg_admin',databaseOIDs:c.target.databaseOIDs}))fail('database_identity_unconfirmed');
  for(const row of rows){
   check(false);row.scratch=backupScratch(c,row.database);const began=io.now();row.state='in_progress';
   try{
    phase='dump';const dump=await call('dump',row);if(!dump.ok||dump.bytes.length<5||dump.bytes.length>64*1024*1024||dump.bytes.subarray(0,5).toString('ascii')!=='PGDMP')fail('dump_failed_or_unknown');
    // Exact custom-format bytes, never converted to text. Kept under this run.
    row.dump={bytes:dump.bytes.length,sha256:dump.stdoutSHA256,path:dump.evidencePrefix+'-stdout.bin'};
    phase='archive-readback';const saved=await io.readDump(row.dump.path,row.dump.bytes);if(!Buffer.isBuffer(saved)||saved.length!==row.dump.bytes||sha256(saved)!==row.dump.sha256)fail('archive_readback_invalid');row.dump.readbackMatched=true;
    phase='source-before';row.source=await fingerprint(row);
    phase='create';const made=await call('create',row,{},false,()=>{row.creation={state:'unknown'};});if(!made.ok||!owned(made.value,row)){if(made.spawnEntered===false)row.creation={state:'not_sent'};fail('create_failed_or_unknown');}row.scratchOID=made.value.oid;row.creation={state:'owned_observed',oid:made.value.oid};
    phase='restore';const restored=await call('restore',row,{scratchOID:row.scratchOID,dumpSHA256:row.dump.sha256,input:saved},false,()=>{row.restore={state:'unknown'};});if(!restored.ok){if(restored.spawnEntered===false)row.restore={state:'not_sent'};fail('restore_failed_or_unknown');}row.restore={state:'completed_response',inputFromRetainedArchive:true};
    phase='restored-fingerprint';row.restored=await fingerprint(row,true);phase='source-after';row.sourceAfter=await fingerprint(row);row.sourceStableDuringCheck=same(row.source,row.sourceAfter);row.samePublicRows=same(row.source,row.restored);
    if(!row.samePublicRows||!row.sourceStableDuringCheck)fail('fingerprint_mismatch_or_concurrent_writes');await io.verifyRuntime();check(false);row.state='verified';
   }catch(e){halt=true;row.state='failed_or_unknown_retained';errors.push({database:row.database,phase,code:e?.message??'unconfirmed'});}
   finally{row.elapsedMs=io.now()-began;if(!Number.isFinite(row.elapsedMs)||row.elapsedMs<0){halt=true;row.state='failed_or_unknown_retained';}await cleanup(row);}
   if(halt||!['dropped_observed','absent_observed'].includes(row.cleanup.state)){halt=true;break;}
  }
  if(!halt){phase='final-runtime-stability';await io.verifyRuntime();check(false);}
 }catch(e){halt=true;errors.push({phase,code:e?.message??'unconfirmed'});}
 const passed=reserved&&!halt&&!io.signal?.aborted&&io.remaining(true)>0&&rows.every(r=>r.state==='verified'&&r.cleanup.state==='dropped_observed');
 const report={formatVersion:1,runId:c?.runId??null,sourceCommit:c?.sourceCommit??null,state:passed?'completed':reserved?'failed_or_unknown_retained':'refused_before_reservation',passed,requested:3,denominator:3,verified:rows.filter(r=>r.state==='verified').length,databases:rows,errors,commandIntents:sequence,backupFormat:'pg_dump custom, exact binary bytes',
  sameInstanceLogicalRestoreOnly:true,regionalDisasterRecoveryProven:false,schemaRecoveryProven:false,identityStoreRecoveryProven:false,recoverySLAProven:false,atomicContinuousSourceSnapshotProven:false,rowMD5IsNotSignature:true,freeCostAccepted:false,retryAllowed:false,resumeAllowed:false,
  limitations:'Selected three business databases; compare public-table row counts and ordered row-JSON MD5 aggregates only. Independent table observations, not a continuously held source snapshot or full schema/ACL/role recovery proof. Restore executes source objects as rg_admin, so trusted source superusers and an explicit isolated-admin window are required. Privileged concurrent catalog/name changes cannot be made CAS-safe by DROP DATABASE. Unknown outcomes and unowned scratch databases are retained for manual review.'};
 if(reserved||io.owned)try{await io.terminal(report);if(passed&&(io.signal?.aborted||io.remaining(true)<=0))return {...report,passed:false,state:'failed_or_unknown_retained',evidenceState:'completion_deadline_or_cancellation'};}catch{return {...report,passed:false,state:'failed_or_unknown_retained',evidenceState:'terminal_persistence_unknown'};}
 return report;
}
