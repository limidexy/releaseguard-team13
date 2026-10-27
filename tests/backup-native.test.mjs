import test from 'node:test';import assert from 'node:assert/strict';
import {backupBoundary} from './fixtures/backup-protocol.mjs';
import {backupCommand,confirmBackupCloud,confirmBackupPod} from '../scripts/backup-native.mjs';
import {backupSQL,backupRemoteProgram,backupScratch} from '../scripts/backup-sql.mjs';
import {sha256} from '../scripts/comparison-files.mjs';
test('closed native argv binds explicit kube context, target Pod/container, fixed program and binary restore input',()=>{
 const b=backupBoundary(),row={database:'rg_registry'},extra={scratchOID:100001,input:b.dump,dumpSHA256:sha256(b.dump)},p=backupCommand(b.c,'restore',row,extra);
 assert.equal(p.command,b.c.cloud.kubectlExecutable);assert.ok(p.args.includes('--context='+b.c.cloud.context));assert.ok(p.args.includes('--kubeconfig='+b.c.cloud.kubeconfigFile));assert.ok(p.args.includes('HOME=/nonexistent'));assert.ok(p.args.includes(backupRemoteProgram));assert.ok(p.args.includes('-i'));assert.deepEqual(p.input,b.dump);
 for(const kind of ['exec','delete','apply','scale','SQL','secrets','dropdb'])assert.throws(()=>backupCommand(b.c,kind,row));assert.throws(()=>backupCommand(b.c,'dump',{database:'postgres'}));assert.throws(()=>backupCommand(b.c,'restore',row,{...extra,input:Buffer.from('changed')}));
});
test('SQL DDL uses guarded standalone statements, owned OID+marker+role, no FORCE and no user shell fragments',()=>{
 const {c}=backupBoundary();for(const db of ['rg_registry','rg_evaluation','rg_governance']){
  const s=backupScratch(c,db);assert.ok(s.length<=63);const created=backupSQL(c,'create',db).sql;assert.match(created,/\\if :rg_allowed/);assert.match(created,/CREATE DATABASE/);assert.match(created,/COMMENT ON DATABASE/);assert.doesNotMatch(created,/BEGIN;/);
  const drop=backupSQL(c,'drop',db,100001).sql;assert.match(drop,/oid=100001/);assert.match(drop,/shobj_description/);assert.match(drop,/datdba=/);assert.doesNotMatch(drop,/FORCE|pg_terminate_backend/);
 }assert.throws(()=>backupSQL(c,'source-table','rg_registry',null,'records; DROP DATABASE postgres;'));
});
for(const mutation of [b=>{b.pod.metadata.uid='foreign';},b=>{b.pod.status.containerStatuses[0].containerID='containerd://new';},b=>{b.pod.status.containerStatuses[0].imageID='postgres@sha256:'+'b'.repeat(64);},b=>{b.pod.spec.containers.push({name:'foreign'});},b=>{b.pod.metadata.deletionTimestamp='2000-01-01';}])test('foreign or changed Pod refuses before a database command',()=>{const b=backupBoundary();mutation(b);assert.throws(()=>confirmBackupPod(b.c,b.pod));});
test('cloud identity check keeps namespace UID/CA/cluster ID bound without declaring cost or node state',()=>{
 const b=backupBoundary();assert.equal(confirmBackupCloud(b.c,b.kube,b.fixtures).notFreeOrDeploymentAttestation,true);b.fixtures.namespace.metadata.uid='foreign';assert.throws(()=>confirmBackupCloud(b.c,b.kube,b.fixtures));
});
