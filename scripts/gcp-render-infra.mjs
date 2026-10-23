import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { browserRoleMapper, personalBrowserRoleDefinitions } from './gcp-browser-identity.mjs';

// Generates manifests only. Private material is never printed or put in Git.
const origin = process.env.PUBLIC_ORIGIN;
if (!origin || new URL(origin).protocol !== 'https:' || !process.env.RG_PUBLIC_IP) throw new Error('Actual HTTPS origin and reserved IP required');
const ns='releaseguard', root=resolve('evidence/private/gcp'), out=resolve('deploy/k8s/rendered');
await mkdir(root,{recursive:true,mode:0o700}); await chmod(root,0o700); await mkdir(out,{recursive:true});
const secretFile=root+'/secrets.json'; let secrets;
try { secrets=JSON.parse(await readFile(secretFile,'utf8')); }
catch(e) { if(e.code!=='ENOENT')throw e; secrets=Object.fromEntries(['admin','registry','evaluation','governance','identity','rabbit','internal','oidcAdmin','ci','viewer','human'].map(k=>[k,randomBytes(36).toString('hex')])); await writeFile(secretFile,JSON.stringify(secrets),{mode:0o600}); }
if(!secrets.humanId){secrets.humanId=randomUUID();await writeFile(secretFile,JSON.stringify(secrets),{mode:0o600});}
const openssl=(args)=>execFileSync('openssl',args,{stdio:'pipe'});
try { await access(root+'/ca.crt'); } catch {
  openssl(['req','-x509','-newkey','rsa:3072','-nodes','-keyout',root+'/ca.key','-out',root+'/ca.crt','-days','90','-subj','/CN=ReleaseGuard Trial Internal CA']);
  for(const name of ['postgres','rabbitmq']) {
    openssl(['req','-newkey','rsa:2048','-nodes','-keyout',`${root}/${name}.key`,'-out',`${root}/${name}.csr`,'-subj',`/CN=${name}`]);
    await writeFile(`${root}/${name}.ext`,`subjectAltName=DNS:${name},DNS:${name}.${ns}.svc,DNS:${name}.${ns}.svc.cluster.local\nextendedKeyUsage=serverAuth\n`,{mode:0o600});
    openssl(['x509','-req','-in',`${root}/${name}.csr`,'-CA',root+'/ca.crt','-CAkey',root+'/ca.key','-CAcreateserial','-out',`${root}/${name}.crt`,'-days','90','-extfile',`${root}/${name}.ext`]);
    await chmod(`${root}/${name}.key`,0o600);
  }
  await chmod(root+'/ca.key',0o600);
}
const docs=[], privateDocs=[];
const meta=name=>({name,namespace:ns});
const add=(kind,name,spec,apiVersion='v1')=>{const doc={apiVersion,kind,metadata:meta(name),...spec};docs.push(doc);return doc};
const sec=(name,stringData)=>privateDocs.push({apiVersion:'v1',kind:'Secret',metadata:meta(name),type:'Opaque',stringData});
const env=(name,value)=>({name,value});
const secretEnv=(name,secret,key=name)=>({name,valueFrom:{secretKeyRef:{name:secret,key}}});
const cm=(name,data)=>add('ConfigMap',name,{data});
const service=(name,ports)=>add('Service',name,{spec:{selector:{app:name},ports:ports.map(([port,targetPort=port])=>({name:'p'+port,port,targetPort})),type:'ClusterIP'}});
const pvc=(name,size)=>add('PersistentVolumeClaim',name,{spec:{accessModes:['ReadWriteOnce'],storageClassName:'standard-rwo',resources:{requests:{storage:size}}}});
const image=(name)=>{const v=process.env[name];if(!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(v??''))throw new Error('Pinned infrastructure image required: '+name);return v};
add('Namespace',ns,{}); delete docs[0].metadata.namespace;
sec('rg-internal',{INTERNAL_SECRET:secrets.internal});
sec('rg-internal-ca',{'ca.crt':await readFile(root+'/ca.crt','utf8')});
for(const name of ['postgres','rabbitmq']) sec(name+'-tls',{'server.crt':await readFile(`${root}/${name}.crt`,'utf8'),'server.key':await readFile(`${root}/${name}.key`,'utf8'),'ca.crt':await readFile(root+'/ca.crt','utf8')});
for(const role of ['registry','evaluation','governance'])sec('rg-'+role,{DATABASE_URL:`postgres://rg_${role}:${secrets[role]}@postgres:5432/rg_${role}?sslmode=verify-full&sslrootcert=/trust/ca.crt`});
sec('rg-postgres',{POSTGRES_PASSWORD:secrets.admin,REGISTRY_DB_PASSWORD:secrets.registry,EVALUATION_DB_PASSWORD:secrets.evaluation,GOVERNANCE_DB_PASSWORD:secrets.governance,IDENTITY_DB_PASSWORD:secrets.identity});
sec('rg-broker',{AMQP_URL:`amqps://rg:${secrets.rabbit}@rabbitmq:5671/releaseguard`,KEDA_MANAGEMENT_URL:`https://rg:${secrets.rabbit}@rabbitmq.releaseguard.svc:15671`,KEDA_TLS:'enable',RABBITMQ_DEFAULT_PASS:secrets.rabbit});
let groq={};try { groq=Object.fromEntries((await readFile('.env.groq','utf8')).split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1).replace(/^['"]|['"]$/g,'')]})); } catch(e) { if(e.code!=='ENOENT')throw e; }
if(groq.MODEL_API_KEY)sec('rg-provider',{MODEL_API_URL:'https://api.groq.com/openai/v1/chat/completions',MODEL_API_KEY:groq.MODEL_API_KEY,MODEL_ID:'openai/gpt-oss-20b',ALLOW_REAL_MODEL:'true'});
const initSql=(await readFile('deploy/postgres/init.sql','utf8'))+"\nCREATE USER rg_identity WITH PASSWORD :'identity_password';\nCREATE DATABASE rg_identity OWNER rg_identity;\nREVOKE CONNECT ON DATABASE rg_identity FROM PUBLIC;\nGRANT CONNECT ON DATABASE rg_identity TO rg_identity;\n";
cm('postgres-init',{'bootstrap.sql':initSql,'init.sh':`#!/bin/sh\nset -eu\npsql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v registry_password="$REGISTRY_DB_PASSWORD" -v evaluation_password="$EVALUATION_DB_PASSWORD" -v governance_password="$GOVERNANCE_DB_PASSWORD" -v identity_password="$IDENTITY_DB_PASSWORD" -f /docker-entrypoint-initdb.d/bootstrap.sql\n`});
// SQL lives outside initdb.d to avoid the entrypoint executing it a second time.
docs.at(-1).data['init.sh']=docs.at(-1).data['init.sh'].replace('/docker-entrypoint-initdb.d/bootstrap.sql','/bootstrap/bootstrap.sql');
cm('postgres-config',{'pg_hba.conf':'local all all trust\nhostssl all all 10.44.0.0/16 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n'});
const stateful=(name,container,volumes,securityContext)=>add('StatefulSet',name,{spec:{serviceName:name,replicas:1,selector:{matchLabels:{app:name}},template:{metadata:{labels:{app:name}},spec:{automountServiceAccountToken:false,securityContext,containers:[container],volumes}}}},'apps/v1');
pvc('postgres-data','5Gi');service('postgres',[[5432]]);
stateful('postgres',{name:'postgres',image:image('PG_IMAGE'),args:['-c','ssl=on','-c','ssl_cert_file=/tls/server.crt','-c','ssl_key_file=/tls/server.key','-c','hba_file=/config/pg_hba.conf'],env:[env('POSTGRES_USER','rg_admin'),env('POSTGRES_DB','postgres'),env('PGDATA','/var/lib/postgresql/data/pgdata'),...['POSTGRES_PASSWORD','REGISTRY_DB_PASSWORD','EVALUATION_DB_PASSWORD','GOVERNANCE_DB_PASSWORD','IDENTITY_DB_PASSWORD'].map(k=>secretEnv(k,'rg-postgres'))],resources:{requests:{cpu:'150m',memory:'256Mi'},limits:{cpu:'1000m',memory:'768Mi'}},volumeMounts:[{name:'data',mountPath:'/var/lib/postgresql/data'},{name:'init',mountPath:'/docker-entrypoint-initdb.d/init.sh',subPath:'init.sh'},{name:'init',mountPath:'/bootstrap/bootstrap.sql',subPath:'bootstrap.sql'},{name:'config',mountPath:'/config'},{name:'tls',mountPath:'/tls',readOnly:true}],readinessProbe:{exec:{command:['pg_isready','-U','rg_admin','-d','postgres']},periodSeconds:5},securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}}},[{name:'data',persistentVolumeClaim:{claimName:'postgres-data'}},{name:'init',configMap:{name:'postgres-init',defaultMode:0o555}},{name:'config',configMap:{name:'postgres-config'}},{name:'tls',secret:{secretName:'postgres-tls',defaultMode:0o640}}],{runAsUser:70,runAsGroup:70,fsGroup:70,runAsNonRoot:true});
cm('rabbit-config',{'rabbitmq.conf':'listeners.tcp = none\nlisteners.ssl.default = 5671\nssl_options.cacertfile = /tls/ca.crt\nssl_options.certfile = /tls/server.crt\nssl_options.keyfile = /tls/server.key\nssl_options.verify = verify_none\nssl_options.fail_if_no_peer_cert = false\nmanagement.ssl.port = 15671\nmanagement.ssl.cacertfile = /tls/ca.crt\nmanagement.ssl.certfile = /tls/server.crt\nmanagement.ssl.keyfile = /tls/server.key\ndefault_vhost = releaseguard\ndefault_permissions.configure = ^releaseguard\\.evaluate$\ndefault_permissions.write = ^(releaseguard\\.evaluate|amq\\.default)$\ndefault_permissions.read = ^releaseguard\\.evaluate$\n'});
pvc('rabbit-data','2Gi');service('rabbitmq',[[5671],[15671]]);
stateful('rabbitmq',{name:'rabbitmq',image:image('RABBIT_IMAGE'),env:[env('RABBITMQ_DEFAULT_USER','rg'),secretEnv('RABBITMQ_DEFAULT_PASS','rg-broker'),env('RABBITMQ_NODENAME','rabbit@rabbitmq-0')],resources:{requests:{cpu:'150m',memory:'384Mi'},limits:{cpu:'750m',memory:'768Mi'}},volumeMounts:[{name:'data',mountPath:'/var/lib/rabbitmq'},{name:'config',mountPath:'/etc/rabbitmq/rabbitmq.conf',subPath:'rabbitmq.conf'},{name:'tls',mountPath:'/tls',readOnly:true}],readinessProbe:{exec:{command:['rabbitmq-diagnostics','-q','ping']},periodSeconds:10},securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}}},[{name:'data',persistentVolumeClaim:{claimName:'rabbit-data'}},{name:'config',configMap:{name:'rabbit-config'}},{name:'tls',secret:{secretName:'rabbitmq-tls',defaultMode:0o640}}],{runAsUser:999,runAsGroup:999,fsGroup:999,runAsNonRoot:true});
// A remounted fsGroup volume can widen an existing Erlang cookie's mode.
// Repair only that file as its non-root owner, without exposing its contents.
const rabbitPod=docs.find(d=>d.kind==='StatefulSet'&&d.metadata.name==='rabbitmq').spec.template.spec;
rabbitPod.initContainers=[{name:'cookie-permissions',image:image('RABBIT_IMAGE'),command:['sh','-ec','if [ -f /var/lib/rabbitmq/.erlang.cookie ]; then chmod 600 /var/lib/rabbitmq/.erlang.cookie; fi'],volumeMounts:[{name:'data',mountPath:'/var/lib/rabbitmq'}],securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}}}];
rabbitPod.containers[0].readinessProbe.timeoutSeconds=5;
const hard=(claim,value,type='String')=>({name:claim,protocol:'openid-connect',protocolMapper:'oidc-hardcoded-claim-mapper',config:{'claim.name':claim,'claim.value':String(value),'jsonType.label':type,'access.token.claim':'true','id.token.claim':'true','userinfo.token.claim':'true'}});
const audience={name:'releaseguard audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.custom.audience':'releaseguard','access.token.claim':'true','id.token.claim':'false'}};
const realm={realm:'releaseguard',enabled:true,sslRequired:'external',registrationAllowed:false,bruteForceProtected:true,accessTokenLifespan:300,roles:{client:{'releaseguard-browser':personalBrowserRoleDefinitions()}},clients:[...['ci','viewer'].map(k=>({clientId:'rg-'+k,secret:secrets[k],enabled:true,protocol:'openid-connect',publicClient:false,serviceAccountsEnabled:true,standardFlowEnabled:false,directAccessGrantsEnabled:false,protocolMappers:[audience,hard('workspace','team13-cloud'),hard('role',k==='ci'?'contributor':'viewer'),hard('service',true,'boolean'),hard('principal','lin-xinda')]})),{clientId:'releaseguard-browser',enabled:true,protocol:'openid-connect',publicClient:true,standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:['http://127.0.0.1:8765/callback'],webOrigins:[origin],attributes:{'pkce.code.challenge.method':'S256'},protocolMappers:[audience,hard('workspace','team13-cloud'),browserRoleMapper(),hard('service',false,'boolean')]}],users:[{username:'xinda',enabled:true,clientRoles:{'releaseguard-browser':['contributor']},requiredActions:['UPDATE_PASSWORD'],credentials:[{type:'password',value:secrets.human,temporary:true}]}]};
// Match the actual human subject, so service submissions cannot be self-approved
// later through that human's interactive login.
realm.users[0].id=secrets.humanId;
for(const client of realm.clients.filter(c=>c.serviceAccountsEnabled))client.protocolMappers.find(m=>m.name==='principal').config['claim.value']=secrets.humanId;
docs.find(d=>d.kind==='ConfigMap'&&d.metadata.name==='rabbit-config').data['rabbitmq.conf']+='default_user_tags.administrator = false\ndefault_user_tags.monitoring = true\n';
sec('rg-identity',{KC_DB_PASSWORD:secrets.identity,KC_BOOTSTRAP_ADMIN_USERNAME:'rgadmin',KC_BOOTSTRAP_ADMIN_PASSWORD:secrets.oidcAdmin,'releaseguard-realm.json':JSON.stringify(realm)});
service('identity',[[8080],[9000]]);
add('Deployment','identity',{spec:{replicas:1,selector:{matchLabels:{app:'identity'}},template:{metadata:{labels:{app:'identity'}},spec:{automountServiceAccountToken:false,securityContext:{runAsUser:1000,runAsGroup:1000,fsGroup:1000,runAsNonRoot:true},containers:[{name:'identity',image:image('IDENTITY_IMAGE'),args:['start','--import-realm'],env:[env('KC_DB','postgres'),env('KC_DB_URL','jdbc:postgresql://postgres:5432/rg_identity?sslmode=verify-full&sslrootcert=/trust/ca.crt'),env('KC_DB_USERNAME','rg_identity'),secretEnv('KC_DB_PASSWORD','rg-identity'),secretEnv('KC_BOOTSTRAP_ADMIN_USERNAME','rg-identity'),secretEnv('KC_BOOTSTRAP_ADMIN_PASSWORD','rg-identity'),env('KC_HOSTNAME',origin+'/auth'),env('KC_HTTP_RELATIVE_PATH','/auth'),env('KC_HTTP_ENABLED','true'),env('KC_PROXY_HEADERS','xforwarded'),env('KC_HEALTH_ENABLED','true'),env('KC_CACHE','local'),env('JAVA_OPTS_KC_HEAP','-Xms256m -Xmx512m')],resources:{requests:{cpu:'250m',memory:'640Mi'},limits:{cpu:'1000m',memory:'1024Mi'}},securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}},volumeMounts:[{name:'realm',mountPath:'/opt/keycloak/data/import/releaseguard-realm.json',subPath:'releaseguard-realm.json',readOnly:true},{name:'trust',mountPath:'/trust',readOnly:true}],startupProbe:{httpGet:{path:'/auth/health/ready',port:9000},failureThreshold:60,periodSeconds:5},readinessProbe:{httpGet:{path:'/auth/health/ready',port:9000},periodSeconds:5}}],volumes:[{name:'realm',secret:{secretName:'rg-identity'}},{name:'trust',secret:{secretName:'rg-internal-ca'}}]}}}},'apps/v1');
cm('edge-config',{Caddyfile:`${new URL(origin).hostname} {\n  encode gzip\n  route {\n  @admin path /auth/admin* /auth/realms/master*\n  respond @admin 404\n  handle /auth/* {\n    reverse_proxy identity:8080\n  }\n  handle {\n    reverse_proxy gateway:8080\n  }\n  }\n}\n`});
pvc('edge-data','1Gi');
add('Deployment','edge',{spec:{replicas:1,strategy:{type:'Recreate'},selector:{matchLabels:{app:'edge'}},template:{metadata:{labels:{app:'edge'}},spec:{automountServiceAccountToken:false,containers:[{name:'edge',image:image('EDGE_IMAGE'),ports:[{containerPort:80},{containerPort:443}],resources:{requests:{cpu:'100m',memory:'64Mi'},limits:{cpu:'500m',memory:'256Mi'}},securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL'],add:['NET_BIND_SERVICE']}},volumeMounts:[{name:'config',mountPath:'/etc/caddy/Caddyfile',subPath:'Caddyfile'},{name:'data',mountPath:'/data'},{name:'runtime',mountPath:'/config'}]}],volumes:[{name:'config',configMap:{name:'edge-config'}},{name:'data',persistentVolumeClaim:{claimName:'edge-data'}},{name:'runtime',emptyDir:{}}]}}}},'apps/v1');
add('Service','edge',{spec:{type:'LoadBalancer',loadBalancerIP:process.env.RG_PUBLIC_IP,selector:{app:'edge'},ports:[{name:'http',port:80,targetPort:80},{name:'https',port:443,targetPort:443}]}});
// Default-deny ingress, then the minimum service dependencies. No DB or broker public service.
add('NetworkPolicy','default-deny-ingress',{spec:{podSelector:{},policyTypes:['Ingress']}},'networking.k8s.io/v1');
for(const [target,sources,ports] of [['gateway',['edge'],[8080]],['identity',['edge'],[8080]],['registry',['gateway','evaluation'],[8080]],['evaluation',['gateway','governance'],[8080]],['governance',['gateway'],[8080]],['support',['worker'],[8080]],['postgres',['registry','evaluation','governance','worker','identity'],[5432]],['rabbitmq',['evaluation','worker'],[5671]]])add('NetworkPolicy','allow-'+target,{spec:{podSelector:{matchLabels:{app:target}},policyTypes:['Ingress'],ingress:[{from:sources.map(app=>({podSelector:{matchLabels:{app}}})),ports:ports.map(port=>({protocol:'TCP',port}))}]}},'networking.k8s.io/v1');
add('NetworkPolicy','allow-edge',{spec:{podSelector:{matchLabels:{app:'edge'}},policyTypes:['Ingress'],ingress:[{ports:[{protocol:'TCP',port:80},{protocol:'TCP',port:443}]}]}},'networking.k8s.io/v1');
await writeFile(out+'/infra.json',JSON.stringify({apiVersion:'v1',kind:'List',items:docs},null,2));
await writeFile(root+'/secrets-k8s.json',JSON.stringify({apiVersion:'v1',kind:'List',items:privateDocs}),{mode:0o600});
console.log('Rendered trial infrastructure and private secrets; no resources applied. Private material excluded from Git.');
