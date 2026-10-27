// Disposable hosted-CI PostgreSQL17 contract ONLY. No cloud/Kubernetes/5193,
// actual user data, credentials, external network or provider. The private CLI
// is exercised separately with owned stubs; this verifies the exact SQL and
// binary native program against real isolated PostgreSQL, not live GKE.
import fs from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';import {backupProcess} from './backup-process.mjs';import {backupCommand} from './backup-native.mjs';import {backupSQL,backupScratch,backupMarker} from './backup-sql.mjs';import {runBackup} from './backup-core.mjs';import {comparisonFiles,comparisonBytes,sha256} from './comparison-files.mjs';
import {backupBoundary} from '../tests/fixtures/backup-protocol.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='linux'||process.env.RG_BACKUP_SQL_INTEGRATION!=='1'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='limidexy/releaseguard-team13'||
 process.env.GITHUB_WORKFLOW!=='ReleaseGuard verification'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.RUNNER_ARCH!=='X64'||!/^\d{6,20}$/.test(process.env.GITHUB_RUN_ID??'')||!/^\/home\/runner\//.test(process.env.RUNNER_TEMP??'')||fs.realpathSync(process.cwd())!==fs.realpathSync(repo)){
 console.error('Disposable backup SQL integration requires this hosted CI scope; no Docker or database operation was entered.');process.exitCode=1;
}else await main();
async function main(){
 // Exact original PR1 PG_IMAGE (PostgreSQL17/amd64), not the latest tag.
 const image='postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3';
 const token=randomUUID(),label='releaseguard.backup-ci-owner',name='rg-backup-ci-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT+'-'+token.slice(0,8),root=fs.mkdtempSync(join(process.env.RUNNER_TEMP,'rg-backup-ci-'));
 const result={scope:'Disposable network-none hosted-CI PostgreSQL17; synthetic data and fake Kubernetes identity only',run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,cloud:false,targetDeployment:false,localUserDocker:false,privateCLIActualGKEValidated:false,checks:[],passed:false,fixtureStopped:false,fixtureRemoved:false};let id,ready=false,runAttempted=false;
 async function docker(args,input,timeout=120000){const r=await backupProcess('docker',args,{cwd:repo,env:{PATH:process.env.PATH},timeout,maxBuffer:66*1024*1024,input});if(r.status!==0||r.signal||r.error||r.outputTruncated)throw Error('Owned CI Docker boundary failed or unknown');return r.stdout;}
 async function owned(){if(!id&&!runAttempted)throw Error('No owned fixture');const known=/^[a-f0-9]{64}$/.test(id??''),x=JSON.parse((await docker(['inspect',known?id:name])).toString())[0];if(known)assert.equal(x.Id,id);assert.equal(x.Config.Labels[label],token);assert.equal(x.Name,'/'+name);assert.equal(x.Config.Image,image);if(!known){id=x.Id;result.launchHandleReconciledForCleanupOnly=true;}return x;}
 const psql=async(db,sql)=>{await owned();return docker(['exec','-i',id,'psql','-X','-w','-U','rg_admin','-d',db,'-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'],Buffer.from(sql));};
 try{
  runAttempted=true;id=(await docker(['run','-d','--name',name,'--label',label+'='+token,'--network','none','--memory','384m','--cpus','0.5','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=268435456','-e','POSTGRES_USER=rg_admin','-e','POSTGRES_DB=postgres','-e','POSTGRES_HOST_AUTH_METHOD=trust',image])).toString().trim();assert.match(id,/^[a-f0-9]{64}$/);result.fixtureImage=image;
  for(let i=0;i<40;i++){await owned();const r=await backupProcess('docker',['exec',id,'sh','-ec','test "$(cat /proc/1/comm)" = postgres && exec pg_isready -U rg_admin -d postgres'],{cwd:repo,env:{PATH:process.env.PATH},timeout:5000,maxBuffer:1024*1024});if(r.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,500));}
  assert.equal(ready,true);
  for(const db of ['rg_registry','rg_evaluation','rg_governance']){
   await psql('postgres',`CREATE DATABASE ${db};\nCOMMENT ON DATABASE ${db} IS 'SYNTHETIC_SOURCE_COMMENT';\n`);
   await psql(db,"CREATE TABLE records(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text NOT NULL, payload jsonb, amount numeric, optional text);\nINSERT INTO records(label,payload,amount,optional) VALUES ('SYNTHETIC 中文', '{\"nested\":[1,true,null]}',12.3400,NULL), (E'SYNTHETIC newline\\nquote ''', '{\"quoted\":\"value\"}',-2.5,'x');\nCREATE INDEX records_label ON records(label);\n");
  }
  const b=backupBoundary(),c=b.c;c.runId=token;assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);c.sourceCommit=process.env.GITHUB_SHA;result.sourceCommit=c.sourceCommit;
  const wire=JSON.parse((await psql('postgres',"SELECT json_build_object('raw',oid,'numeric',oid::bigint) FROM pg_database WHERE datname='rg_registry';")).toString());
  assert.equal(typeof wire.raw,'string');assert.equal(typeof wire.numeric,'number');assert.equal(wire.raw,String(wire.numeric));
  const actual=JSON.parse((await psql('postgres',backupSQL(c,'identity').sql)).toString());assert.equal(Object.keys(actual.databaseOIDs).length,3);assert.ok(Object.values(actual.databaseOIDs).every(x=>Number.isInteger(x)&&x>=16384&&x<=4294967295));Object.assign(c.target,{systemIdentifier:actual.systemIdentifier,serverVersionNum:actual.serverVersionNum,postmasterEpoch:actual.postmasterEpoch,databaseOIDs:actual.databaseOIDs});
  result.checks.push({name:'PostgreSQL OID wire-type regression: raw string remains observable; explicit bigint returns exact numeric source identities',passed:true,rawOIDType:typeof wire.raw,numericOIDType:typeof wire.numeric});
  assert.ok(c.target.serverVersionNum>=170000&&c.target.serverVersionNum<180000);
  const files=comparisonFiles(root,c.runId,'cloud-backup'),schemaChecked=[];
  const io={signal:new AbortController().signal,now:()=>performance.now(),remaining:()=>600000,get owned(){return files.owned;},reserve:()=>files.reserve({scope:result.scope,sourceCommit:c.sourceCommit}),json:files.json,put:files.put,
   preflight:b.io.preflight,verifyRuntime:async()=>{},terminal:r=>files.json('terminal.json',r),readDump:(path,size)=>comparisonBytes(join(files.directory,path),{privateMode:true,limit:size}),
   async command(kind,row,extra,clean){await owned();const plan=backupCommand(c,kind,row,extra),after=plan.args.indexOf('--');assert.ok(after>0);const cmd=plan.args.slice(after+1);assert.deepEqual(cmd.slice(0,2),['env','-i']);
    const r=await backupProcess('docker',['exec',...(plan.input?['-i']:[]),id,...cmd],{cwd:repo,env:{PATH:process.env.PATH},input:plan.input,timeout:120000,maxBuffer:66*1024*1024});
    if(r.status!==0||r.signal||r.error||r.outputTruncated)result.lastFailedSyntheticBoundary={kind,status:r.status,signal:r.signal??null,errorCode:r.error?.code??null,stderr:r.stderr.toString('utf8').slice(0,4000)};
    if(kind==='restore'&&r.status===0&&!r.error){const actual=(await psql(backupScratch(c,row.database),"SELECT ((SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='records')=2 AND (SELECT last_value FROM public.records_id_seq)=2);\n")).toString().trim();assert.equal(actual,'t');schemaChecked.push(row.database);}return r;},
  };
  const report=await runBackup(c,io);result.protocol={state:report.state,verified:report.verified,errors:report.errors,databases:report.databases.map(x=>({database:x.database,state:x.state,creation:x.creation.state,restore:x.restore.state,cleanup:x.cleanup.state}))};assert.equal(report.passed,true,JSON.stringify(report.errors));assert.equal(report.verified,3);assert.equal(report.databases.every(x=>x.cleanup.state==='dropped_observed'),true);
  result.checks.push({name:'Full three-database native custom dump/restore/public fingerprint/owned cleanup',passed:true,databases:3,commandIntents:report.commandIntents});
  for(const row of report.databases){const raw=fs.readFileSync(join(files.directory,row.dump.path));assert.equal(raw.subarray(0,5).toString(),'PGDMP');assert.equal(sha256(raw),row.dump.sha256);}
  result.checks.push({name:'Exact custom-format binary archives survive private storage',passed:true});
  assert.equal(schemaChecked.length,3);result.checks.push({name:'Synthetic index and identity-sequence fixture restored in all three scratch databases',passed:true});
  const remaining=JSON.parse((await psql('postgres',"SELECT json_agg(datname) FROM pg_database WHERE datname LIKE 'rg_verify_%';")).toString());assert.equal(remaining,null);
  result.checks.push({name:'No run-owned scratch databases remain after the successful protocol',passed:true});
  // PostgreSQL must refuse a wrong in-session system identity before DDL.
  const wrong=structuredClone(c);wrong.runId=randomUUID();wrong.target.systemIdentifier='1';const sql=backupSQL(wrong,'create','rg_registry'),wrongRun=await backupProcess('docker',['exec','-i',id,'psql','-X','-w','-U','rg_admin','-d','postgres','-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'],{cwd:repo,env:{PATH:process.env.PATH},input:Buffer.from(sql.sql),timeout:5000,maxBuffer:1024*1024});assert.notEqual(wrongRun.status,0);
  const absent=JSON.parse((await psql('postgres',`SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='${backupScratch(wrong,'rg_registry')}') AS absent;`)).toString().trim()==='t'?'true':'false');assert.equal(absent,true);
  result.checks.push({name:'Wrong server identity is rejected by PostgreSQL before scratch creation',passed:true});
  // Negative ownership controls exercise real PostgreSQL, not only fake output.
  const negative=structuredClone(c);negative.runId=randomUUID();const created=JSON.parse((await psql('postgres',backupSQL(negative,'create','rg_registry').sql)).toString()),scratch=backupScratch(negative,'rg_registry');
  const rejectDrop=async oid=>{const r=await backupProcess('docker',['exec','-i',id,'psql','-X','-w','-U','rg_admin','-d','postgres','-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'],{cwd:repo,env:{PATH:process.env.PATH},input:Buffer.from(backupSQL(negative,'drop','rg_registry',oid).sql),timeout:5000,maxBuffer:1024*1024});assert.notEqual(r.status,0);const v=JSON.parse((await psql('postgres',backupSQL(negative,'owned','rg_registry').sql)).toString());assert.equal(v.exists,true);};
  await rejectDrop(created.oid+1);await psql('postgres',`COMMENT ON DATABASE "${scratch}" IS 'SYNTHETIC_FOREIGN_OWNER_MARKER';\n`);await rejectDrop(created.oid);
  result.checks.push({name:'Wrong scratch OID and changed ownership marker each prevent DROP in PostgreSQL',passed:true});
  // This isolated test administrator restores its own marker only to tear down
  // the negative fixture; the operator never rewrites an unowned marker.
  await psql('postgres',`COMMENT ON DATABASE "${scratch}" IS '${backupMarker(negative,'rg_registry')}';\n`);assert.equal(JSON.parse((await psql('postgres',backupSQL(negative,'drop','rg_registry',created.oid).sql)).toString()).absent,true);
  result.serverVersionNum=c.target.serverVersionNum;result.passed=true;
 }catch(e){result.failureCode=e?.code??e?.message??'unconfirmed';result.failureMessage=String(e?.message??'unconfirmed').slice(0,4000);process.exitCode=1;}
 finally{
  if(runAttempted)try{await owned();await docker(['stop','--time','5',id]);const x=await owned();assert.equal(x.State.Running,false);result.fixtureStopped=true;await docker(['rm',id]);result.fixtureRemoved=true;}catch{result.cleanupUnconfirmed=true;result.passed=false;process.exitCode=1;}
  if(!result.fixtureStopped||!result.fixtureRemoved){result.passed=false;process.exitCode=1;}
  fs.mkdirSync(join(repo,'evidence'),{recursive:true});fs.writeFileSync(join(repo,'evidence/backup-sql-integration.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  // Only synthetic test material is removed; private archives are never uploaded.
  if(result.fixtureRemoved&&root.startsWith(process.env.RUNNER_TEMP+'/rg-backup-ci-'))fs.rmSync(root,{recursive:true});
  console.log(JSON.stringify(result,null,2));
 }
}
