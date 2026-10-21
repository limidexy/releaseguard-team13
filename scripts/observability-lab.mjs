// Local verification only. No cloud, model credentials, production activation or Git actions.
import fs from 'node:fs/promises';
import {openSync,closeSync,appendFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {SignJWT} from 'jose';
const repo=fileURLToPath(new URL('../',import.meta.url));
const root=path.join(repo,'.local/observability-lab');
await fs.mkdir(path.join(root,'logs'),{recursive:true});
const stateFile=path.join(root,'private.json');
let state;try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e){
  if(e.code!=='ENOENT')throw e;
  state={db:randomBytes(24).toString('hex'),broker:randomBytes(24).toString('hex'),auth:randomBytes(32).toString('hex'),internal:randomBytes(32).toString('hex'),children:[]};
  await save();
}
async function save(){await fs.writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});}
const infraEnv={...process.env,RG_LAB_DB_PASSWORD:state.db,RG_LAB_BROKER_PASSWORD:state.broker,RG_LAB_LOG_DIR:path.join(root,'logs')};
const compose=['compose','-f',path.join(repo,'deploy/observability/compose.yaml')];
function docker(args){const r=spawnSync('docker',[...compose,...args],{cwd:repo,env:infraEnv,stdio:'inherit'});if(r.status!==0)throw new Error('Local Docker operation failed');}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(f,timeout=60000){const end=Date.now()+timeout;let last;do{try{const v=await f();if(v)return v;}catch(e){last=e;}await sleep(500);}while(Date.now()<end);throw new Error('Readiness timeout: '+(last?.message??''));}
const ports={registry:54994,evaluation:54995,governance:54996,support:54997,worker:54998,gateway:54993};
const databases={registry:'rg_lab_registry',evaluation:'rg_lab_evaluation',governance:'rg_lab_governance',support:'rg_lab_support'};
const adminUrl=`postgres://postgres:${state.db}@127.0.0.1:54951/postgres`;
const dbUrl=role=>`postgres://${databases[role]}:${state.db}@127.0.0.1:54951/${databases[role]}`;
const action=process.argv[2]??'start';
if(action==='pull'){docker(['pull']);}
else if(action==='infra'){docker(['up','-d']);}
else if(action==='start'){
  for(const child of state.children){try{process.kill(child.pid,0);throw new Error('Existing lab process recorded; stop this lab before starting again');}catch(e){if(e.code!=='ESRCH')throw e;}}
  docker(['up','-d']);
  for(const url of ['http://127.0.0.1:54310/ready','http://127.0.0.1:54300/api/health','http://127.0.0.1:54686/'])await eventually(async()=>{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});return r.ok;});
  await eventually(async()=>{const p=new pg.Pool({connectionString:adminUrl});try{await p.query('SELECT 1');return true;}finally{await p.end();}});
  const admin=new pg.Pool({connectionString:adminUrl});
  try{for(const name of Object.values(databases)){
    if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount){
      const sql=(await admin.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L',$1::text,$2::text)",[name,state.db])).rows[0].format;await admin.query(sql);
    }
    if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query(`CREATE DATABASE ${name} OWNER ${name}`);
  }}finally{await admin.end();}
  // A bounded connection probe, not an inference request.
  await eventually(async()=>{const {default:amqp}=await import('amqplib');const c=await amqp.connect(`amqp://rg_lab:${state.broker}@127.0.0.1:54952`);await c.close();return true;});
  state.children=[];
  for(const role of ['registry','support','evaluation','governance','worker','gateway']){
    const env={...process.env,SERVICE_ROLE:role,PORT:String(ports[role]),AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:state.auth,INTERNAL_SECRET:state.internal,
      REGISTRY_URL:'http://127.0.0.1:54994',EVALUATION_URL:'http://127.0.0.1:54995',GOVERNANCE_URL:'http://127.0.0.1:54996',PUBLIC_ORIGIN:'http://localhost:54993',
      DATABASE_URL:dbUrl(role==='worker'?'evaluation':databases[role]?role:'registry'),
      SUPPORT_DATABASE_URL:role==='support'?dbUrl('support'):'',AMQP_URL:`amqp://rg_lab:${state.broker}@127.0.0.1:54952`,
      RUNNER_ORIGINS:'http://127.0.0.1:54997',ALLOW_REAL_MODEL:'false',MODEL_API_KEY:'',MODEL_API_URL:'',MODEL_ID:'',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'http://127.0.0.1:54318/v1/traces'};
    const fd=openSync(path.join(root,'logs',role+'.jsonl'),'a',0o600);
    const child=spawn(process.execPath,[path.join(repo,'dist/src/main.js')],{cwd:repo,env,stdio:['ignore',fd,fd],detached:true});closeSync(fd);child.unref();
    state.children.push({role,pid:child.pid});await save();
    await eventually(async()=>{const r=await fetch(`http://127.0.0.1:${ports[role]}/health/ready`,{signal:AbortSignal.timeout(1500)});return r.ok;});
  }
  console.log(JSON.stringify({localOnly:true,application:'http://localhost:54993',traces:'http://localhost:54686',logs:'http://localhost:54300/d/releaseguard-local',inferenceEnabled:false}));
}else if(action==='verify'){
  const workspace='observability-'+randomUUID();
  const token=await new SignJWT({workspace,role:'contributor',service:false}).setSubject('local-verification').setProtectedHeader({alg:'HS256'}).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(state.auth));
  const checks=[];
  async function api(resource,body){const r=await fetch('http://127.0.0.1:54993/api/v2/'+resource,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':randomUUID()},body:body?JSON.stringify(body):undefined});const j=await r.json();return {http:r.status,data:j,traceId:r.headers.get('x-trace-id')};}
  function check(name,ok){checks.push({name,passed:Boolean(ok)});if(!ok)throw new Error('Verification failed: '+name);}
  const fixture=JSON.parse(await fs.readFile(path.join(repo,'public/demo-fixtures.json'),'utf8'));
  const app=await api('applications',{name:'Local tracing fixture',description:'Synthetic replay, no provider calls',runnerUrl:'http://127.0.0.1:54997/execute'});check('application created',app.http===201);
  const suite=await api('suites',fixture.suite);check('suite created',suite.http===201);
  const job=await api('jobs',{appId:app.data.id,suiteId:suite.data.id,candidate:'observability-replay',commitRef:'local-candidate',source:'replay',promptVersion:'v1',scenario:'passing'});check('job admitted',job.http===202);
  const final=await eventually(async()=>{const j=await api('jobs/'+job.data.id);return j.data.status==='succeeded'?j:null;});check('replay passed',final.data.result.gate==='passed');
  await sleep(2000);
  const traced=await eventually(async()=>{const r=await fetch('http://127.0.0.1:54686/api/traces/'+job.traceId);const j=await r.json();return j.data?.[0]?.spans?.some(s=>s.operationName==='rabbitmq process')?j:null;});
  const services=new Set(Object.values(traced.data[0].processes).map(p=>p.serviceName));
  check('single trace crosses five actual services',['gateway','evaluation','registry','worker','support'].every(s=>services.has('releaseguard-'+s)));
  check('producer and consumer spans present',['rabbitmq publish','rabbitmq process'].every(n=>traced.data[0].spans.some(s=>s.operationName===n)));
  await fs.writeFile(path.join(root,'trace.json'),JSON.stringify(traced,null,2));
  const canary='RG_NO_LOG_'+randomUUID();
  await fetch('http://127.0.0.1:54993/api/v2/applications?secret='+canary,{headers:{authorization:'Bearer '+canary,cookie:'password='+canary}});
  const logQuery=`{job="releaseguard-local"} |= "${job.traceId}"`;
  const logs=await eventually(async()=>{const params=new URLSearchParams({query:logQuery,limit:'200',start:String(BigInt(Date.now()-3600000)*1000000n),end:String(BigInt(Date.now())*1000000n)});const r=await fetch('http://127.0.0.1:54310/loki/api/v1/query_range?'+params);const j=await r.json();const services=new Set(j.data?.result?.flatMap(x=>x.values.map(v=>JSON.parse(v[1]).service))??[]);return services.size>=5?j:null;});
  const lines=logs.data.result.flatMap(x=>x.values.map(v=>JSON.parse(v[1])));
  check('aggregated logs correlate at least five services',new Set(lines.map(x=>x.service)).size>=5);
  await fs.writeFile(path.join(root,'aggregated-logs.json'),JSON.stringify(logs,null,2));
  for(const file of await fs.readdir(path.join(root,'logs'))){check('no auth/query canary in '+file,!(await fs.readFile(path.join(root,'logs',file),'utf8')).includes(canary));}
  const {CircuitBreaker,PostgresCircuitStore,CircuitOpenError}=await import('../dist/src/circuit-breaker.js');
  const {inSpan,SpanKind,tracedFetch,traceFields,initializeTelemetry,flushTelemetry}=await import('../dist/src/observability.js');
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='http://127.0.0.1:54318/v1/traces';initializeTelemetry('breaker-fixture');
  const {createServer}=await import('node:http');let calls=0,healthy=false;
  const fixtureServer=createServer((_req,res)=>{calls++;res.writeHead(healthy?200:503);res.end('synthetic outage fixture');});await new Promise(r=>fixtureServer.listen(0,'127.0.0.1',r));
  const localUrl='http://127.0.0.1:'+fixtureServer.address().port;
  const pools=[new pg.Pool({connectionString:dbUrl('support')}),new pg.Pool({connectionString:dbUrl('support')})];
  const stores=pools.map(p=>new PostgresCircuitStore(p));await Promise.all(stores.map(s=>s.init()));
  const breakers=stores.map(s=>new CircuitBreaker(s,{threshold:3,cooldownMs:300,probeLeaseMs:2000},fields=>{
    appendFileSync(path.join(root,'logs/breaker-fixture.jsonl'),JSON.stringify({level:30,time:Date.now(),service:'breaker-fixture',...fields,...traceFields()})+'\n');
  }));
  const quota='local-fixture-'+randomUUID();let circuitTrace;
  try{await inSpan('local breaker fixture',SpanKind.SERVER,async()=>{
    circuitTrace=traceFields().traceId;
    const request=()=>tracedFetch('synthetic-provider',localUrl).then(async r=>{await r.text();if(!r.ok)throw new Error('Provider HTTP '+r.status);return true;});
    for(let i=0;i<3;i++){try{await breakers[i%2].run(quota,request);}catch(e){check('fixture failure '+(i+1),e.message==='Provider HTTP 503');}}
    const blocked=await Promise.all(Array.from({length:20},(_,i)=>breakers[i%2].run(quota,request).then(()=>false,e=>e instanceof CircuitOpenError)));
    check('20 concurrent calls rejected without HTTP',blocked.every(Boolean)&&calls===3);
    await sleep(310);healthy=true;
    const probes=await Promise.all(breakers.map(b=>b.run(quota,async()=>{await sleep(100);return request();}).then(()=>true,e=>e instanceof CircuitOpenError?false:Promise.reject(e))));
    check('one cross-instance half-open probe',probes.filter(Boolean).length===1&&calls===4);
    await breakers[1].run(quota,request);check('recovery closes circuit',calls===5);
  });}finally{await new Promise(r=>fixtureServer.close(r));await Promise.all(pools.map(p=>p.end()));await flushTelemetry();}
  const report={checkedAt:new Date().toISOString(),source:'local actual HTTP + RabbitMQ + PostgreSQL + OTLP/Jaeger + Alloy/Loki; synthetic provider fixture',newModelCalls:0,newReviewerCalls:0,cloudDeployments:0,checks,traceId:job.traceId,jobId:job.data.id,services:[...services],circuitFixture:{httpRequests:calls,circuitTrace},shadowOnly:true,reviewer:'calibration_pending'};
  await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}else if(action==='stop'){
  for(const child of state.children){const ps=spawnSync('ps',['-p',String(child.pid),'-o','command='],{encoding:'utf8'});if(ps.status===0&&ps.stdout.includes(path.join(repo,'dist/src/main.js')))process.kill(child.pid,'SIGTERM');}
  state.children=[];await save();docker(['stop']);console.log('Stopped only the isolated observability lab. Existing containers and data untouched.');
}else throw new Error('Use pull, infra, start, verify or stop');
