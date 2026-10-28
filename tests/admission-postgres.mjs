// Real PostgreSQL regression: only a uniquely labelled disposable Docker
// container on loopback. No existing database, cloud, model, approval or retry.
// Requires `npm run build` and a locally cached postgres:16-alpine image.
// Usage: node tests/admission-postgres.mjs [after-label]
// Optional RG_ADMISSION_EVIDENCE_DIR chooses a local output folder.
// Different old/new admission algorithms must not coexist during cutover.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import pg from 'pg';
import {tmpdir} from 'node:os';
const exec=promisify(execFile), root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.RG_ADMISSION_EVIDENCE_DIR ? path.resolve(process.env.RG_ADMISSION_EVIDENCE_DIR) : await fs.mkdtemp(path.join(tmpdir(),'rg-admission-real-'));
await fs.mkdir(output,{recursive:true,mode:0o700});
const label=process.argv[2]??'after';
assert(/^(before|after)[a-z0-9-]*$/.test(label));
const {admitAtomic}=await import(pathToFileURL(root+'/dist/src/admission-atomic.js'));
const schema=(await fs.readFile(root+'/src/evaluation.ts','utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
const tag=randomBytes(6).toString('hex'),name='rg-slot-isolation-'+tag,password=randomBytes(24).toString('hex');
const docker=async args=>(await exec('docker',args,{env:{...process.env,POSTGRES_PASSWORD:password},timeout:25000,maxBuffer:2000000})).stdout;
const report={at:new Date().toISOString(),label,scope:'actual isolated PostgreSQL; synthetic requests, no cloud/model/customer data',tests:[],cleanup:null};
let id,pool,admin;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){const until=Date.now()+7000;while(Date.now()<until){if(await fn())return;await sleep(10);}throw Error('controlled wait timeout');}
function request(rateKey,limit,workspace='test-a',principal='actor-a'){return {rateKey,limit,id:randomUUID(),outboxId:randomUUID(),workspace,principal,hash:'synthetic-request',key:'test_'+randomBytes(12).toString('hex'),input:{source:'replay'},snapshot:{application:{},suite:{}}};}
function pinned(c){return {totalCount:1,idleCount:0,waitingCount:0,connect:async()=>({processID:c.processID,on:c.on.bind(c),off:c.off.bind(c),query:c.query.bind(c),release(){}})};}
async function reset(){await admin.query('TRUNCATE outbox,jobs,admission_slots,admission_windows,admission_limits CASCADE');}
async function test(name,fn){await reset();let detail=null;try{detail=await fn();report.tests.push({name,passed:true,detail});}catch(e){report.tests.push({name,passed:false,error:e.message,actual:e.actual??null,expected:e.expected??null});}}
try {
 id=(await docker(['run','-d','--pull=never','--name',name,'--label','releaseguard.slot-isolation='+tag,'--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_USER=rg_test','-e','POSTGRES_PASSWORD','-p','127.0.0.1::5432','postgres:16-alpine'])).trim();
 const info=JSON.parse(await docker(['inspect',id]))[0];assert.equal(info.Config.Labels['releaseguard.slot-isolation'],tag);
 const port=Number(info.NetworkSettings.Ports['5432/tcp'][0].HostPort);
 const settings={host:'127.0.0.1',port,database:'postgres',user:'rg_test',password,max:16,connectionTimeoutMillis:5000,statement_timeout:5000};
 await wait(async()=>{const c=new pg.Client(settings);try{await c.connect();await c.end();return true;}catch{await c.end().catch(()=>{});return false;}});
 pool=new pg.Pool(settings);admin=new pg.Client(settings);await admin.connect();await admin.query(schema);
 await test('a full workspace cannot spend another workspace free slot',async()=>{
  const a=request('workspace-a:actor:minute',2),b=request('workspace-b:actor:minute',2,'test-b');
  assert.equal(await admitAtomic(pool,a),true);assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_second_a'}),true);
  assert.equal(await admitAtomic(pool,b),true);
  const allowed=await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_third_a'});
  assert.equal(allowed,false,'exhausted workspace borrowed a different workspace quota');
 });
 await test('a full principal cannot spend another principal free slot',async()=>{
  const a=request('workspace:actor-a:minute',2),b=request('workspace:actor-b:minute',2,'test-a','actor-b');
  await admitAtomic(pool,a);await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_second_principal'});await admitAtomic(pool,b);
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_third_principal'}),false);
 });
 await test('cold simultaneous first arrivals do not falsely reject spare capacity',async()=>{
  const a=request('cold:actor:minute',16),c1=await pool.connect(),c2=await pool.connect();
  let pending;
  try{
   await c1.query('BEGIN');assert.equal(await admitAtomic(pinned(c1),a),true);
   pending=admitAtomic(pinned(c2),{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_cold_second'});
   await wait(async()=>{const r=await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[c2.processID]);return r.rows[0]?.wait_event_type==='Lock';});
   await c1.query('COMMIT');const accepted=await pending;assert.equal(accepted,true,'second request saw stale statement snapshot after waiting for first initializer');
  }finally{await c1.query('ROLLBACK').catch(()=>{});await pending?.catch(()=>{});c1.release();c2.release();}
 });
 await test('same-minute legacy reservations are not silently reset',async()=>{
  const a=request('legacy:actor:minute',3);
  await admin.query("INSERT INTO admission_limits VALUES($1,2,now()+interval '2 minutes')",[a.rateKey]);
  assert.equal(await admitAtomic(pool,a),true);
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_legacy_over_cap'}),false,'old count=2 plus two new admissions exceeded limit=3');
 });
 await test('job and outbox failure rolls back the permit claim',async()=>{
  const a=request('rollback:actor:minute',3);assert.equal(await admitAtomic(pool,a),true);
  await assert.rejects(admitAtomic(pool,{...a,id:randomUUID(),key:'test_duplicate_outbox'}),e=>e.code==='23505');
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_rollback_second'}),true);
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_rollback_third'}),true);
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_rollback_fourth'}),false);
  assert.equal(Number((await admin.query('SELECT count(*) n FROM jobs')).rows[0].n),3);
 });
 await test('warm parallel submissions cannot exceed the exact configured cap',async()=>{
  const a=request('parallel:actor:minute',16);await admitAtomic(pool,a);
  const answers=await Promise.all(Array.from({length:32},()=>admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_'+randomBytes(12).toString('hex')})));
  assert.equal(answers.filter(Boolean).length,15);assert.equal(Number((await admin.query('SELECT count(*) n FROM jobs')).rows[0].n),16);
 });

 await test('another minute cannot donate its unclaimed quota',async()=>{
  const a=request('workspace:actor:minute-1',2),b=request('workspace:actor:minute-2',2);
  await admitAtomic(pool,a);await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_old_minute_2'});await admitAtomic(pool,b);
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_old_minute_over'}),false);
 });
 await test('failed first outbox write rolls back cold window initialization too',async()=>{
  const old=request('previous:actor:minute',2);await admitAtomic(pool,old);
  const a={...request('new:actor:minute',2),outboxId:old.outboxId};
  await assert.rejects(admitAtomic(pool,a),e=>e.code==='23505');
  assert.equal(Number((await admin.query('SELECT count(*) n FROM admission_windows WHERE key=$1',[a.rateKey])).rows[0].n),0);
  assert.equal(await admitAtomic(pool,{...a,outboxId:randomUUID()}),true);
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_new_second'}),true);
  assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_new_over'}),false);
 });
 await test('64 concurrent cold requests all use spare capacity without retry',async()=>{
  const a=request('cold64:actor:minute',64);
  const accepted=await Promise.all(Array.from({length:64},()=>admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_'+randomBytes(12).toString('hex')})));
  assert.equal(accepted.filter(Boolean).length,64);
  assert.equal(Number((await admin.query('SELECT count(*) n FROM outbox')).rows[0].n),64);
 });
 await test('zero limit never creates a quota window or job',async()=>{
  assert.equal(await admitAtomic(pool,request('zero:actor:minute',0)),false);
  for(const table of ['jobs','outbox','admission_slots','admission_windows'])assert.equal(Number((await admin.query('SELECT count(*) n FROM '+table)).rows[0].n),0);
 });
 await test('an active window refuses a different configured limit',async()=>{
  const a=request('change:actor:minute',2);await admitAtomic(pool,a);
  await assert.rejects(admitAtomic(pool,{...a,limit:3,id:randomUUID(),outboxId:randomUUID(),key:'test_limit_changed'}),e=>e.code==='22023');
  assert.equal(Number((await admin.query('SELECT count(*) n FROM jobs')).rows[0].n),1);
 });
 await test('observed legacy writer drift fails closed after cutover',async()=>{
  const a=request('drift:actor:minute',4);
  await admin.query("INSERT INTO admission_limits VALUES($1,1,now()+interval '2 minutes')",[a.rateKey]);
  await admitAtomic(pool,a);await admin.query('UPDATE admission_limits SET count=2 WHERE key=$1',[a.rateKey]);
  await assert.rejects(admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_drift'}),e=>e.code==='55000');
  assert.equal(Number((await admin.query('SELECT count(*) n FROM jobs')).rows[0].n),1);
 });
 await test('one held slot does not block a different available slot',async()=>{
  const a=request('held:actor:minute',4);await admitAtomic(pool,a);const c=await pool.connect();
  try{
   await c.query('BEGIN');await c.query('SELECT slot FROM admission_slots WHERE key=$1 AND slot=2 FOR UPDATE',[a.rateKey]);
   assert.equal(await admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_next_free_slot'}),true);
   const slots=(await admin.query('SELECT slot,claimed FROM admission_slots WHERE key=$1 ORDER BY slot',[a.rateKey])).rows;
   assert.equal(slots.find(x=>x.slot===2).claimed,false);assert.equal(slots.find(x=>x.slot===3).claimed,true);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 await test('abandoned request cannot initialize or claim quota',async()=>{
  await assert.rejects(admitAtomic(pool,request('abandoned:actor:minute',4),{isAbandoned:()=>true}),e=>e.code==='RG_SUBMISSION_ABANDONED');
  assert.equal(Number((await admin.query('SELECT count(*) n FROM admission_windows')).rows[0].n),0);
 });
 await test('1000 cap remains exact under 1100 one-shot concurrent submissions',async()=>{
  const a=request('large:actor:minute',1000);
  const accepted=await Promise.all(Array.from({length:1100},()=>admitAtomic(pool,{...a,id:randomUUID(),outboxId:randomUUID(),key:'test_'+randomBytes(12).toString('hex')})));
  assert.equal(accepted.filter(Boolean).length,1000);
  for(const table of ['jobs','outbox'])assert.equal(Number((await admin.query('SELECT count(*) n FROM '+table)).rows[0].n),1000);
  assert.equal(Number((await admin.query('SELECT count(*) n FROM admission_slots WHERE claimed')).rows[0].n),1000);
  return {attempted:1100,accepted:1000,rejected:100,retries:0};
 });
} catch(e){report.fatal={name:e.name,message:e.message};}
finally{
 await admin?.end().catch(()=>{});await pool?.end().catch(()=>{});
 if(id){const info=JSON.parse(await docker(['inspect',id]))[0];assert.equal(info.Id,id);assert.equal(info.Config.Labels['releaseguard.slot-isolation'],tag);await docker(['stop','--timeout','3',id]);await docker(['rm',id]);const remaining=(await docker(['ps','-aq','--filter','label=releaseguard.slot-isolation='+tag])).trim();report.cleanup={name,id,remaining,removed:remaining===''};}
 report.passed=report.tests.filter(t=>t.passed).length;report.failed=report.tests.filter(t=>!t.passed).length;
 await fs.writeFile(output+'/'+label+'.json',JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
 if(report.fatal||report.failed||!report.cleanup?.removed)process.exitCode=1;
}
