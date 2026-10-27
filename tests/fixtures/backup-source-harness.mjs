// Frozen original under owned fake kubectl/SQL/fs/clock only. No actual DB,
// process forwarding, credential, cloud, Docker or restoration is performed.
import {backupSource as source} from './backup-source-pr1.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(createHash('sha256').update(source).digest('hex'),'9e5066863a8445a81f9430780e720d40b125b528bb1ef8d7bb331adff711335f');
const executable=source.replace("import { execFileSync } from 'node:child_process';\n",'').replace("import { mkdir, writeFile } from 'node:fs/promises';\n",'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
export async function simulateBackup(options={}){
 let clock=options.startMs??0,created=0,unknown=false;const epoch=Date.parse('2000-01-01T00:00:00Z'),calls=[],writes=options.writes??new Map(),overwrites=[],databases=new Map(['registry','evaluation','governance'].map(role=>['rg_'+role,'1|synthetic-content-md5\n'])),prints=[];
 const env={RG_ALLOW_CLOUD_SMOKE:'true',RG_COMMIT:'e94d4f1c1b438a90551c18f832c7844e1a822df2',...options.env},process={env,exitCode:0};
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[epoch+clock]));}static now(){return epoch+clock;}}
 function exec(command,args,opts){
  assert.equal(command,'kubectl');assert.deepEqual(args.slice(0,3),['-n','releaseguard','exec']);let index=3;if(args[index]==='-i')index++;
  assert.equal(args[index++],'postgres-0');assert.equal(args[index++],'--');const tool=args[index++],a=args.slice(index);clock+=10;calls.push({tool,args:a,inputBytes:opts?.input?.length??0,at:clock,kubectlArgs:args});
  if(tool==='pg_dump'){const db=a[a.indexOf('-d')+1];assert.ok(databases.has(db));return Buffer.from('SYNTHETIC_CUSTOM_DUMP:'+db+':'+(options.dumpVersion??'v1'));}
  if(tool==='psql'){const db=a[a.indexOf('-d')+1],q=a[a.indexOf('-c')+1];assert.ok(databases.has(db));if(q.startsWith('SELECT tablename'))return Buffer.from('records\n');assert.match(q,/^SELECT count\(\*\),COALESCE\(md5\(string_agg/);return Buffer.from(databases.get(db));}
  if(tool==='createdb'){const db=a.at(-1);assert.equal(databases.has(db),false);databases.set(db,'0|empty\n');created++;
   if(options.unknownCreateAfter&&!unknown){unknown=true;throw Error('SYNTHETIC_CREATE_RESPONSE_UNKNOWN');}return Buffer.alloc(0);}
  if(tool==='pg_restore'){const db=a[a.indexOf('-d')+1];assert.ok(databases.has(db));assert.ok(opts.input.toString().startsWith('SYNTHETIC_CUSTOM_DUMP:'));databases.set(db,options.mismatch?'2|different\n':'1|synthetic-content-md5\n');return Buffer.alloc(0);}
  if(tool==='dropdb'){const db=a.at(-1);assert.match(db,/^rg_verify_(?:registry|evaluation|governance)_\d+$/);assert.ok(databases.has(db));databases.delete(db);return Buffer.alloc(0);}
  throw Error('Unselected synthetic boundary');
 }
 await new AsyncFunction('execFileSync','mkdir','writeFile','process','performance','Date','console',executable)(exec,async()=>{},async(p,b,opts)=>{if(writes.has(p))overwrites.push({path:p,priorBytes:Buffer.byteLength(writes.get(p)),nextBytes:Buffer.byteLength(b)});writes.set(p,Buffer.isBuffer(b)?Buffer.from(b):String(b));},process,{now:()=>clock},FakeDate,{log:s=>prints.push(String(s))});
 const raw=writes.get('evidence/current/cloud-backup-restore.json');assert.equal(typeof raw,'string');return {report:JSON.parse(raw),rawReport:raw,exitCode:process.exitCode,calls,writes,overwrites,created,remainingScratch:[...databases.keys()].filter(k=>k.startsWith('rg_verify_')),prints,
  simulation:{actualProcess:0,actualDatabase:0,actualCloud:0,actualDocker:0,sourceReportCloudTrueIsOriginalRawField:true,clock:'synthetic year2000',notActualBackupOrRecoveryProof:true}};
}
