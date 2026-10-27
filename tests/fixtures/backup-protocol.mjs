// Synthetic DB/process/cloud model, not actual PostgreSQL acceptance evidence.
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureConfig,kubeconfig,cloudFixtures} from './gcp-evidence-data.mjs';
import {backupScratch,backupMarker,backupSQL} from '../../scripts/backup-sql.mjs';
import {confirmBackupCloud,confirmBackupPod} from '../../scripts/backup-native.mjs';
import {sha256} from '../../scripts/comparison-files.mjs';
const clone=x=>structuredClone(x);
export function backupBoundary(options={}){
 const cloud=fixtureConfig(join(tmpdir(),'rg-backup-unit'),{mode:'collect-readonly',powerOnly:true}).cloud;
 const c={allowCloudBackupRestore:true,runId:'61111111-1111-4111-8111-111111111111',sourceCommit:'1'.repeat(40),deadlineMs:600000,cloud,target:{acknowledgement:'I_AUTHORIZE_TRUSTED_SOURCE_THREE_DB_SCRATCH_RESTORE_AND_OWNED_CLEANUP',podName:'postgres-0',podUID:'synthetic-postgres-uid',containerName:'postgres',containerID:'containerd://synthetic-postgres-id',imageDigest:'sha256:'+'a'.repeat(64),nodeName:'synthetic-node',systemIdentifier:'7400000000000000001',serverVersionNum:170009,postmasterEpoch:'1793000000.123456',databaseOIDs:{rg_registry:16384,rg_evaluation:16385,rg_governance:16386}}};
 const fixtures=cloudFixtures(cloud),kube={server:'https://192.0.2.10',caSHA256:sha256(Buffer.from(kubeconfig(cloud).clusters[0].cluster['certificate-authority-data'],'base64'))};
 const pod={apiVersion:'v1',kind:'Pod',metadata:{name:c.target.podName,uid:c.target.podUID,namespace:cloud.namespace},spec:{nodeName:c.target.nodeName,containers:[{name:'postgres'}]},status:{conditions:[{type:'Ready',status:'True'}],containerStatuses:[{name:'postgres',containerID:c.target.containerID,imageID:'postgres@'+c.target.imageDigest,ready:true,state:{running:{startedAt:'2000-01-01T00:00:00Z'}}}]}};
 const records=new Map(),binaries=new Map(),events=[],scratch=new Map(),controller=new AbortController(),dump=Buffer.concat([Buffer.from('PGDMP'),Buffer.from([255,0,254,195])]);let clock=0,remaining=600000,reserved=false,owned=true,oid=100000;
 const result=(value,opts={})=>({status:0,signal:null,stdout:Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)+'\n'),stderr:Buffer.alloc(0),spawnEntered:true,outputTruncated:false,...opts});
 const absent={exists:false,owned:false,oid:null,marker:null,owner:null};
 const io={signal:controller.signal,now:()=>clock,remaining:()=>remaining,get owned(){return reserved;},
  async reserve(){events.push({type:'reserve'});if(reserved)throw Error('synthetic_duplicate_run');reserved=true;},
  async preflight(){events.push({type:'preflight'});confirmBackupCloud(c,kube,fixtures);confirmBackupPod(c,pod);},
  async json(name,value,clean=false){events.push({type:'persist',name,cleanup:clean});if(options.failPersist?.(name,value))throw Error('synthetic_persistence_failure');if(records.has(name))throw Error('synthetic_overwrite');records.set(name,clone(value));},
  async put(name,bytes,clean=false){events.push({type:'binary',name,cleanup:clean});if(binaries.has(name))throw Error('synthetic_overwrite');binaries.set(name,Buffer.from(bytes));},
  async readDump(name){const bytes=Buffer.from(binaries.get(name));if(options.corruptArchive)bytes[0]=0;return bytes;},
  async command(kind,row,extra,clean){
   clock+=10;remaining-=10;const db=row?.database;events.push({type:'command',kind,database:db,cleanup:clean,inputSHA256:extra.input?sha256(extra.input):null});
   backupSQL(c,kind,db,extra.scratchOID,extra.table);
   if(options.beforeCommand)await options.beforeCommand({kind,row,extra,clean,scratch,c,pod});
   const unknown={status:null,error:{code:'SYNTHETIC_RESPONSE_UNKNOWN'}};
   if(kind==='identity')return result({systemIdentifier:options.foreignSystem?'999':c.target.systemIdentifier,serverVersionNum:c.target.serverVersionNum,postmasterEpoch:c.target.postmasterEpoch,role:'rg_admin',databaseOIDs:c.target.databaseOIDs});
   if(kind==='dump')return result(options.badDump?Buffer.from([255,0]):dump);
   if(kind==='source-tables'||kind==='restored-tables')return result(options.badTable?['bad;drop_database']:['records']);
   if(kind==='source-table'||kind==='restored-table')return result({table:extra.table,count:'2',hash:options.mismatch&&kind==='restored-table'?'b'.repeat(32):'a'.repeat(32)});
   if(kind==='create'){
    if(options.createNotSent)return result(Buffer.alloc(0),{...unknown,spawnEntered:false});
    const v={exists:true,owned:!options.unmarkedCreate,oid:++oid,owner:'rg_admin',marker:options.unmarkedCreate?null:backupMarker(c,db)};scratch.set(backupScratch(c,db),v);
    return result(v,options.unknownCreate?unknown:{});
   }
   if(kind==='owned')return result(scratch.get(backupScratch(c,db))??absent,options.unknownOwned?unknown:{});
   if(kind==='restore'){if(!extra.input.equals(dump))throw Error('synthetic_binary_changed');return result(Buffer.alloc(0),options.unknownRestore?unknown:{});}
   if(kind==='drop'){const name=backupScratch(c,db),s=scratch.get(name);if(!s||!s.owned||s.oid!==extra.scratchOID)throw Error('synthetic_unowned_drop');scratch.delete(name);return result({absent:true},options.unknownDrop?unknown:{});}
   throw Error('synthetic_unselected_kind');
  },
  async verifyRuntime(){if(options.sourceDrift)throw Error('synthetic_source_drift');},
  async terminal(r){await io.json('terminal.json',r,true);if(options.terminalFailure)throw Error('synthetic_terminal_failure');if(options.abortAfterTerminal)controller.abort();},
 };
 return {c,io,pod,kube,fixtures,records,binaries,events,scratch,controller,dump,get reserved(){return reserved;},setRemaining:x=>{remaining=x;},setClock:x=>{clock=x;}};
}
