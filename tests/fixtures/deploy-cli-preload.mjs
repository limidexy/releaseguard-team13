// Native process/API fixture. Owned copied directory only. External sockets,
// real cloud tools and provider calls are forbidden. The frozen offline manifest
// renderer is the sole forwarded child, using a closed environment/owned path.
import fs from 'node:fs';import fsp from 'node:fs/promises';import child from 'node:child_process';import net from 'node:net';import dgram from 'node:dgram';import http from 'node:http';import https from 'node:https';import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {deployFixture} from './tests/fixtures/deploy-lifecycle.mjs';import {cloudFixtures} from './tests/fixtures/gcp-evidence-data.mjs';import {captureDeploymentObject,deploymentObjectRef,planDeploymentClaim} from './scripts/deploy-object-core.mjs';
const root=dirname(fileURLToPath(import.meta.url));if(!root.split('/').at(-1).startsWith('rg-deploy-owned-'))throw Error('Owned fixture only');
const c=JSON.parse(fs.readFileSync(join(root,'inputs/config.json'))),fault=process.env.RG_SYNTHETIC_DEPLOY_FAULT??'',f=deployFixture({missing:JSON.parse(fs.readFileSync(join(root,'missing.json')))}),fixtures=cloudFixtures(c.cloud),run=join(root,'evidence/private/cloud-deploy',c.runId),deny=()=>{throw Error('External boundary forbidden');},realSpawn=child.spawn;
const key=r=>r.kind+'/'+r.name,manager='releaseguard-owned-deploy';
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;for(const m of[http,https]){m.request=deny;m.get=deny;}for(const name of['spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
const opened=fsp.open;let faulted=false;fsp.open=async(p,...args)=>{if(String(p).endsWith('/.env'))deny();const h=await opened(p,...args),sync=h.sync.bind(h);h.sync=async()=>{if(!faulted&&(fault==='intent-sync'&&/operations\/\d+-intent.json$/.test(String(p))||fault==='terminal-sync'&&String(p).endsWith('/terminal.json'))){faulted=true;throw Error('SYNTHETIC_SYNC_FAILURE');}return sync();};return h;};
child.spawn=(command,args,options)=>{
 if(command===process.execPath){if(args.length!==1||args[0]!==join(run,'render-stage/scripts/render-cloud.mjs')||options.cwd!==join(run,'render-stage')||Object.keys(options.env).some(k=>!['PATH','RG_IMAGE','PUBLIC_ORIGIN','AUTH_ISSUER','OIDC_JWKS_URL','SUBMISSION_CLOCK_SKEW_BOUND_MS','RG_INTERNAL_CA','RG_TRIAL_SMALL','RG_SKIP_NAMESPACE','RG_ENABLE_WORKER_FAULT_FIXTURE','RG_DEPLOYMENT_ENV'].includes(k)))deny();return realSpawn(command,args,options);}
 const intents=fs.readdirSync(run).filter(n=>/^(?:cleanup-)?native-\d{6}-intent.json$/.test(n)).sort((a,b)=>Number(a.match(/\d{6}/)[0])-Number(b.match(/\d{6}/)[0])),intent=JSON.parse(fs.readFileSync(join(run,intents.at(-1))));
 if(command!==intent.command||JSON.stringify(args)!==JSON.stringify(intent.args)||options.env.CLOUDSDK_CONFIG!==c.cloud.gcloudConfigDirectory||options.env.KUBECONFIG!==c.cloud.kubeconfigFile||options.env.RELEASEGUARD_TOKEN||options.env.NODE_OPTIONS)deny();
 fs.appendFileSync(join(root,'synthetic-commands.jsonl'),JSON.stringify({kind:intent.kind,args,intentPersisted:true})+'\n',{mode:0o600});const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=deny;let supplied;
 async function complete(){try{
  let v;const kind=intent.kind,position=args.findIndex(x=>['get','patch','apply','create','delete'].includes(x));
  if(kind==='cluster')v=fixtures.cluster;
  else if(kind==='namespace')v=fixtures.namespace;
  else if(kind==='get')v=await f.io.get({kind:args[position+1],name:args[position+2]});
  else if(['patch','previewPatch'].includes(kind)){
   const file=args.find(x=>x.startsWith('--patch-file=')).slice(13),patch=JSON.parse(fs.readFileSync(file)),ref=deploymentObjectRef(args[position+1],args[position+2]),api=f.api.get(key(ref));
   if(!file.startsWith(run+'/')||patch[0].path!=='/metadata/uid'||patch[1].path!=='/metadata/resourceVersion'||!args.includes('--show-managed-fields=true')||!args.includes('--field-manager='+manager))deny();
   v=kind==='previewPatch'?api.preview(patch):api.patch(patch);
   if(kind==='patch'&&fault==='lost-patch'&&!faulted){faulted=true;throw Error('LOST_AFTER_ACCEPT');}
  }else if(kind==='previewApply'){
   const d=JSON.parse(supplied),old=f.api.get(d.kind+'/'+d.metadata.name).read();v=structuredClone(old);v.metadata.labels={...old.metadata.labels,...d.metadata.labels};v.metadata.annotations={...old.metadata.annotations,...d.metadata.annotations};if(d.kind==='ConfigMap')v.data=d.data;else{v.spec={...old.spec,...d.spec};if(d.kind==='Service')for(const k of['clusterIP','clusterIPs','ipFamilies','ipFamilyPolicy'])if(Object.hasOwn(old.spec,k))v.spec[k]=old.spec[k];}
  }else if(kind==='previewCreate')v=await f.io.previewCreate(JSON.parse(supplied));
  else if(kind==='create'){v=await f.io.create(JSON.parse(supplied));if(fault==='lost-create'&&!faulted){faulted=true;throw Error('LOST_CREATE');}}
  else if(kind==='deleteCreated'){
   const path=args.find(x=>x.startsWith('--raw=')),resource=path.includes('/services/')?'Service':'ConfigMap',name=path.split('/').at(-1),ref=deploymentObjectRef(resource,name),before=f.api.get(key(ref)).read(),body=JSON.parse(supplied);if(body.preconditions.uid!==before.metadata.uid||body.preconditions.resourceVersion!==before.metadata.resourceVersion||args.some(x=>x.includes('force')))deny();v=await f.io.deleteCreated(captureDeploymentObject(ref,before));
  }else deny();
  fs.writeFileSync(join(root,'synthetic-state.json'),JSON.stringify(Object.fromEntries([...f.api].map(([k,a])=>[k,a.read()]))),{mode:0o600});
  if(v!==null)p.stdout.emit('data',Buffer.from(JSON.stringify(v)));p.emit('close',0,null);
 }catch{p.stderr.emit('data',Buffer.from('SYNTHETIC_UNCONFIRMED_NATIVE_RESULT'));p.emit('close',1,null);}}
 if(options.stdio[0]==='pipe'){p.stdin=new EventEmitter();p.stdin.end=b=>{supplied=Buffer.from(b);queueMicrotask(complete);};}else queueMicrotask(complete);return p;
};syncBuiltinESMExports();
let application,suite,jobInput,phases=0;const ids={app:'11111111-1111-4111-8111-111111111112',suite:'11111111-1111-4111-8111-111111111113',job:'11111111-1111-4111-8111-111111111114'},token='INSECURE_SYNTHETIC_ACCESS_TOKEN';
globalThis.fetch=async(url,init)=>{
 if(!String(url).startsWith(c.render.origin+'/')||init.redirect!=='error'||init.cache!=='no-store')deny();
 const issuer=url===c.render.issuer+'/protocol/openid-connect/token';if(!issuer&&init.headers.authorization!=='Bearer '+token)deny();
 const files=fs.readdirSync(run).filter(n=>/^smoke-.*-\d{4}-intent.json$/.test(n));if(!files.length)deny();
 fs.appendFileSync(join(root,'synthetic-requests.jsonl'),JSON.stringify({url,method:init.method,body:issuer?null:init.body?JSON.parse(init.body):null})+'\n',{mode:0o600});
 if(issuer){phases++;if(new URLSearchParams(init.body).get('client_secret')!=='INSECURE_SYNTHETIC_SECRET')deny();return new Response(JSON.stringify({access_token:token,token_type:'Bearer',expires_in:120}),{headers:{'content-type':'application/json'}});}
 let body,status=200;
 if(url.endsWith('/applications')){application=JSON.parse(init.body);body={id:ids.app,...application};status=201;}
 else if(url.endsWith('/suites')){suite=JSON.parse(init.body);body={id:ids.suite,version:1,...suite};status=201;}
 else if(url.endsWith('/jobs')&&init.method==='POST'){jobInput=JSON.parse(init.body);if(jobInput.source!=='replay'||jobInput.scenario!=='passing')deny();body={id:ids.job,status:'queued'};status=202;}
 else if(url.endsWith('/jobs/'+ids.job)){body={id:ids.job,input:jobInput,snapshot:{application:{id:ids.app,data:application},suite:{id:ids.suite,version:1,data:suite}},status:'succeeded',result:{total:10,passed:10,errors:0,criticalFailures:0,score:100,gate:'passed',results:suite.cases.map(c=>({caseId:c.id,status:'passed',output:'SYNTHETIC ONLY',latencyMs:0}))}};
  if(fault==='candidate-smoke'&&phases===1)body.result.score=90;
  if(fault==='foreign-worker'&&phases===1){body.result.score=90;f.api.get('Deployment/worker').mutate(d=>d.metadata.uid='foreign-worker');}
 }else deny();
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
};
