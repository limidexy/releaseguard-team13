// Closed PostgreSQL17 protocol. No IO/credentials on import. DROP DATABASE has
// no catalog compare-and-swap: an explicitly isolated admin window is required;
// a malicious/concurrent privileged administrator remains outside this proof.
const deny=()=>{throw Error('Backup SQL refused');};
export const backupDatabases=Object.freeze(['rg_registry','rg_evaluation','rg_governance']);
const oid=v=>Number.isInteger(v)&&v>=16384&&v<=4294967295;
export function backupScratch(c,db){if(!backupDatabases.includes(db)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.runId??''))deny();return 'rg_verify_'+db.slice(3)+'_'+c.runId.replace(/-/g,'');}
export const backupMarker=(c,db)=>'releaseguard-backup:'+c.runId+':'+db;
const q=s=>"'"+s.replace(/'/g,"''")+"'",ident=s=>'"'+s.replace(/"/g,'""')+'"';
function identity(c){const t=c.target;if(!/^\d{1,22}$/.test(t.systemIdentifier??'')||!/^\d{1,15}\.\d{6}$/.test(t.postmasterEpoch??'')||!Number.isInteger(t.serverVersionNum)||t.serverVersionNum<170000||t.serverVersionNum>=180000)deny();
 return `(pg_control_system()).system_identifier::text=${q(t.systemIdentifier)} AND current_setting('server_version_num')::int=${t.serverVersionNum} AND extract(epoch from pg_postmaster_start_time())::text=${q(t.postmasterEpoch)} AND current_user='rg_admin'`;}
function source(c,db){if(!backupDatabases.includes(db)||!oid(c.target.databaseOIDs[db]))deny();return `EXISTS(SELECT 1 FROM pg_database WHERE datname=${q(db)} AND oid=${c.target.databaseOIDs[db]})`;}
function owned(c,db,scratchOID){if(!oid(scratchOID))deny();const s=backupScratch(c,db);return `EXISTS(SELECT 1 FROM pg_database WHERE datname=${q(s)} AND oid=${scratchOID} AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND shobj_description(oid,'pg_database')=${q(backupMarker(c,db))})`;}
const guarded=(guard,sql)=>`\\set ON_ERROR_STOP on\nSELECT (${guard}) AS rg_allowed \\gset\n\\if :rg_allowed\n${sql}\n\\else\nSELECT 1/0;\n\\endif\n`;
export function backupSQL(c,kind,db,scratchOID,table){
 const target=identity(c),s=db===undefined?null:backupScratch(c,db),marker=db===undefined?null:backupMarker(c,db);
 // PostgreSQL emits the OID type as a JSON string. Cast at the SQL boundary
 // to bigint so both the identity and scratch receipts have exact numeric OIDs.
 if(kind==='identity')return {database:'postgres',mode:'query',guard:'',sql:"SELECT json_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'serverVersionNum',current_setting('server_version_num')::int,'postmasterEpoch',extract(epoch from pg_postmaster_start_time())::text,'role',current_user,'databaseOIDs',(SELECT json_object_agg(datname,oid::bigint) FROM pg_database WHERE datname IN ('rg_registry','rg_evaluation','rg_governance')));"};
 const base=target+' AND '+source(c,db);
 if(kind==='dump')return {database:db,mode:'dump',guard:'SELECT ('+base+` AND current_database()=${q(db)});`,sql:''};
 if(kind==='create')return {database:'postgres',mode:'query',guard:'',sql:guarded(base+` AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=${q(s)})`,
  `CREATE DATABASE ${ident(s)} TEMPLATE template0;\nCOMMENT ON DATABASE ${ident(s)} IS ${q(marker)};\n`+ownedQuery(s,marker))};
 if(kind==='owned')return {database:'postgres',mode:'query',guard:'',sql:guarded(target,ownedQuery(s,marker))};
 const isSource=kind==='source-tables'||kind==='source-table',guard=base+(isSource?` AND current_database()=${q(db)}`:' AND '+owned(c,db,scratchOID)+` AND current_database()=${q(s)}`);
 if(kind==='restore')return {database:s,mode:'restore',guard:'SELECT ('+guard+');',sql:''};
 if(kind==='drop')return {database:'postgres',mode:'query',guard:'',sql:guarded(base+' AND '+owned(c,db,scratchOID),`DROP DATABASE ${ident(s)};\nSELECT json_build_object('absent',NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=${q(s)}));`)};
 if(['source-tables','restored-tables'].includes(kind))return {database:isSource?db:s,mode:'query',guard:'',sql:guarded(guard,"SELECT COALESCE(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public';")};
 if(['source-table','restored-table'].includes(kind)){
  if(typeof table!=='string'||!/^[_a-z]+$/.test(table)||table.length>63)deny();
  return {database:isSource?db:s,mode:'query',guard:'',sql:guarded(guard,`SELECT json_build_object('table',${q(table)},'count',count(*)::text,'hash',COALESCE(md5(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text)),'empty')) FROM public.${ident(table)} t;`)};
 }deny();
}
function ownedQuery(s,marker){return `SELECT json_build_object('exists',EXISTS(SELECT 1 FROM pg_database WHERE datname=${q(s)}),'owned',EXISTS(SELECT 1 FROM pg_database WHERE datname=${q(s)} AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND shobj_description(oid,'pg_database')=${q(marker)}),'oid',(SELECT oid::bigint FROM pg_database WHERE datname=${q(s)}),'marker',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=${q(s)}),'owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=${q(s)}));`;}
// SQL scripts are fixed builder output passed as one quoted argument, never a
// caller-provided shell fragment. The dump remains binary on stdout/stdin.
export const backupRemoteProgram=`db=$1
mode=$2
guard=$3
action=$4
check() {
 proof=$(psql -X -w -h /var/run/postgresql -p 5432 -U rg_admin -d "$db" -A -t -q -v ON_ERROR_STOP=1 -c "$guard")
 [ "$proof" = t ]
}
case "$mode" in
 query) printf '%s\\n' "$action" | psql -X -w -h /var/run/postgresql -p 5432 -U rg_admin -d "$db" -A -t -q -v ON_ERROR_STOP=1 -f - ;;
 dump) check; pg_dump -w -h /var/run/postgresql -p 5432 -U rg_admin -d "$db" -Fc; check ;;
 restore) check; pg_restore -w -h /var/run/postgresql -p 5432 -U rg_admin -d "$db" --no-owner --no-acl --exit-on-error ;;
 *) exit 42 ;;
esac`;
