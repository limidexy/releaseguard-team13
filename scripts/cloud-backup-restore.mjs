import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
if(process.env.RG_ALLOW_CLOUD_SMOKE!=='true')throw Error('Explicit trial acceptance required');
const p=(command,args=[],input)=>execFileSync('kubectl',['-n','releaseguard','exec',...(input?['-i']:[]),'postgres-0','--',command,...args],{input,maxBuffer:64*1024*1024,timeout:120000});
const sql=(db,q)=>p('psql',['-U','rg_admin','-d',db,'-X','-A','-t','-v','ON_ERROR_STOP=1','-c',q]).toString().trim();
const fingerprint=db=>{const names=sql(db,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").split('\n').filter(Boolean);return names.map(table=>{if(!/^[a-z_]+$/.test(table))throw Error('Unexpected table');const [count,hash]=sql(db,`SELECT count(*),COALESCE(md5(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text)),'empty') FROM ${table} t`).split('|');return{table,count:Number(count),hash}})};
const root='evidence/private/gcp/backups';await mkdir(root,{recursive:true,mode:0o700});await mkdir('evidence/current',{recursive:true});
const report={at:new Date().toISOString(),cloud:true,sourceCommit:process.env.RG_COMMIT,method:'pg_dump custom format; restore to newly created scratch database on the same PostgreSQL instance; compare public-table row counts and sorted row-content hashes; remove only this run-created scratch DB.',limitations:'Same-instance logical restore; not regional disaster recovery, managed backup scheduling, identity-store recovery or a measured recovery-time SLA.',databases:[]};
try{
 for(const role of ['registry','evaluation','governance']){
  const db='rg_'+role,scratch='rg_verify_'+role+'_'+Date.now(),start=performance.now();let created=false;
  try{
   const dump=p('pg_dump',['-U','rg_admin','-d',db,'-Fc']);await writeFile(root+'/'+db+'.dump',dump,{mode:0o600});
   const before=fingerprint(db);p('createdb',['-U','rg_admin',scratch]);created=true;
   p('pg_restore',['-U','rg_admin','-d',scratch,'--no-owner','--no-acl','--exit-on-error'],dump);
   const restored=fingerprint(scratch),unchanged=JSON.stringify(before)===JSON.stringify(fingerprint(db)),same=JSON.stringify(before)===JSON.stringify(restored);
   report.databases.push({database:db,dumpBytes:dump.length,elapsedMs:performance.now()-start,source:before,restored,sourceStableDuringCheck:unchanged,passed:unchanged&&same});
   if(!same||!unchanged)throw Error('Content mismatch or concurrent writes in '+db);
  }finally{if(created)p('dropdb',['-U','rg_admin',scratch])}
 }
 report.passed=true;
}catch(e){report.passed=false;report.error=String(e);process.exitCode=1}
finally{report.finishedAt=new Date().toISOString();await writeFile('evidence/current/cloud-backup-restore.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,databases:report.databases.map(d=>({database:d.database,passed:d.passed,dumpBytes:d.dumpBytes})),error:report.error}));}
