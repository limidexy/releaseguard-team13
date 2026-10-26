// Explicit material -> private plan only. No filesystem, provider, identity-server,
// key generation or deployment operations occur in this module.
import { X509Certificate, createPrivateKey, createHash } from 'node:crypto';
import { validateInfrastructureConfig } from './gcp-infra-core.mjs';
const secretNames=['admin','registry','evaluation','governance','identity','rabbit','internal','oidcAdmin','ci','viewer'];
const roles=['owner','contributor','reviewer','viewer'];
const invalid=()=>{throw Error('Invalid explicit private inputs');};
function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))invalid();}
function text(value,min=1,max=150){if(typeof value!=='string'||value.length<min||value.length>max||/[\x00-\x20\x7f]/.test(value))invalid();return value;}
function secret(value){return text(value,32,256);}
function pem(value,label){if(typeof value!=='string'||value.length>32768||!new RegExp('^-----BEGIN '+label+'-----\\r?\\n[A-Za-z0-9+/=\\r\\n]+-----END '+label+'-----\\r?\\n?$').test(value))invalid();return value;}
function strong(key){const d=key.asymmetricKeyDetails;if(key.asymmetricKeyType==='rsa'){if(!d||d.modulusLength<2048)invalid();}else if(key.asymmetricKeyType==='ec'){if(!['prime256v1','secp384r1','secp521r1'].includes(d?.namedCurve))invalid();}else invalid();}
function validAt(cert,now){const from=Date.parse(cert.validFrom),to=Date.parse(cert.validTo);if(!Number.isFinite(from)||!Number.isFinite(to)||now<from||now>=to)invalid();}
function tlsMaterial(input,now){
 exact(input,['ca','postgres','rabbitmq']);const ca=new X509Certificate(pem(input.ca,'CERTIFICATE'));
 if(!ca.ca||!ca.verify(ca.publicKey))invalid();strong(ca.publicKey);validAt(ca,now);
 const checked={};let previousPublicKey;
 for(const name of ['postgres','rabbitmq']){
  exact(input[name],['certificate','key']);
  const cert=new X509Certificate(pem(input[name].certificate,'CERTIFICATE'));
  const keyText=input[name].key;
  if(typeof keyText!=='string'||keyText.length>32768||!/^-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1-----\r?\n?$/.test(keyText))invalid();
  const key=createPrivateKey(keyText);strong(cert.publicKey);strong(key);validAt(cert,now);
  if(cert.ca||!cert.checkIssued(ca)||!cert.verify(ca.publicKey)||!cert.checkPrivateKey(key)||
     cert.raw.equals(ca.raw)||cert.publicKey.equals(ca.publicKey)||
     !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.1')||Date.parse(cert.validTo)>Date.parse(ca.validTo)||Date.parse(cert.validFrom)<Date.parse(ca.validFrom))invalid();
  for(const host of [name,name+'.releaseguard.svc',name+'.releaseguard.svc.cluster.local']){
   if(!cert.checkHost(host,{subject:'never',wildcards:false,partialWildcards:false,multiLabelWildcards:false,singleLabelSubdomains:false}))invalid();
  }
  if(previousPublicKey?.equals(cert.publicKey))invalid();previousPublicKey=cert.publicKey;
  checked[name]={certificate:input[name].certificate,key:keyText};
 }
 return {ca:input.ca,...checked};
}
function identityPlan(input,secrets,origin){
 exact(input,['workspace','subjects','servicePrincipals']);
 const workspace=text(input.workspace,1,100);
 if(!Array.isArray(input.subjects)||input.subjects.length<1||input.subjects.length>20)invalid();
 const ids=new Set(),names=new Set();
 const subjects=input.subjects.map(s=>{
  exact(s,['id','username','role']);const id=text(s.id),username=text(s.username,1,100);
  if(!/^[a-zA-Z0-9._@-]+$/.test(username)||!roles.includes(s.role)||ids.has(id)||names.has(username.toLowerCase())||username.toLowerCase()==='rgadmin'||username.toLowerCase().startsWith('service-account-'))invalid();
  ids.add(id);names.add(username.toLowerCase());return {id,username,role:s.role};
 });
 exact(input.servicePrincipals,['ci','viewer']);
 for(const kind of ['ci','viewer']){
  const id=text(input.servicePrincipals[kind]);
  const subject=subjects.find(s=>s.id===id);
  if(!subject||kind==='ci'&&!['owner','contributor'].includes(subject.role))invalid();
 }
 const hard=(claim,value,type='String')=>({name:claim,protocol:'openid-connect',protocolMapper:'oidc-hardcoded-claim-mapper',
  config:{'claim.name':claim,'claim.value':String(value),'jsonType.label':type,'access.token.claim':'true','id.token.claim':'true','userinfo.token.claim':'true'}});
 const audience=()=>({name:'releaseguard audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',
  config:{'included.custom.audience':'releaseguard','access.token.claim':'true','id.token.claim':'false'}});
 const clients=['ci','viewer'].map(kind=>({
  clientId:'rg-'+kind,secret:secrets[kind],enabled:true,protocol:'openid-connect',publicClient:false,
  serviceAccountsEnabled:true,standardFlowEnabled:false,directAccessGrantsEnabled:false,fullScopeAllowed:false,defaultClientScopes:[],
  protocolMappers:[audience(),hard('workspace',workspace),hard('role',kind==='ci'?'contributor':'viewer'),hard('service',true,'boolean'),hard('principal',input.servicePrincipals[kind])],
 }));
 clients.push({
  clientId:'releaseguard-browser',enabled:true,protocol:'openid-connect',publicClient:true,standardFlowEnabled:true,
  serviceAccountsEnabled:false,directAccessGrantsEnabled:false,fullScopeAllowed:true,defaultClientScopes:[],
  redirectUris:['http://127.0.0.1:8765/callback'],webOrigins:[origin],attributes:{'pkce.code.challenge.method':'S256'},
  protocolMappers:[audience(),hard('workspace',workspace),hard('service',false,'boolean'),{
   name:'approved browser role',protocol:'openid-connect',protocolMapper:'oidc-usermodel-client-role-mapper',
   config:{'usermodel.clientRoleMapping.clientId':'releaseguard-browser','usermodel.clientRoleMapping.rolePrefix':'',
    'claim.name':'role','jsonType.label':'String',multivalued:'false','access.token.claim':'true','id.token.claim':'true','userinfo.token.claim':'true'},
  }],
 });
 return {
  realm:'releaseguard',enabled:true,sslRequired:'external',registrationAllowed:false,bruteForceProtected:true,accessTokenLifespan:300,
  clients,roles:{client:{'releaseguard-browser':roles.map(name=>({name,composite:false,clientRole:true}))}},
  users:subjects.map(s=>({id:s.id,username:s.username,enabled:true,clientRoles:{'releaseguard-browser':[s.role]}})),
 };
}
export function renderGcpPrivateInputs(input,now){
 try{
  exact(input,['infrastructure','secrets','tls','identity']);
  if(!Number.isSafeInteger(now)||now<=0)invalid();
  const config=validateInfrastructureConfig(input.infrastructure);exact(input.secrets,secretNames);
  const secrets=Object.fromEntries(secretNames.map(name=>[name,secret(input.secrets[name])]));
  const tls=tlsMaterial(input.tls,now),realm=identityPlan(input.identity,secrets,config.publicOrigin),items=[];
  const add=(name,stringData)=>items.push({apiVersion:'v1',kind:'Secret',metadata:{name,namespace:'releaseguard'},type:'Opaque',stringData});
  add('rg-internal',{INTERNAL_SECRET:secrets.internal});
  add('rg-internal-ca',{'ca.crt':tls.ca});
  for(const name of ['postgres','rabbitmq'])add(name+'-tls',{'server.crt':tls[name].certificate,'server.key':tls[name].key,'ca.crt':tls.ca});
  for(const role of ['registry','evaluation','governance'])add('rg-'+role,{DATABASE_URL:'postgres://rg_'+role+':'+encodeURIComponent(secrets[role])+'@postgres:5432/rg_'+role+'?sslmode=verify-full&sslrootcert=/trust/ca.crt'});
  add('rg-postgres',{POSTGRES_PASSWORD:secrets.admin,REGISTRY_DB_PASSWORD:secrets.registry,EVALUATION_DB_PASSWORD:secrets.evaluation,GOVERNANCE_DB_PASSWORD:secrets.governance,IDENTITY_DB_PASSWORD:secrets.identity});
  add('rg-broker',{AMQP_URL:'amqps://rg:'+encodeURIComponent(secrets.rabbit)+'@rabbitmq:5671/releaseguard',
   KEDA_MANAGEMENT_URL:'https://rg:'+encodeURIComponent(secrets.rabbit)+'@rabbitmq.releaseguard.svc:15671',KEDA_TLS:'enable',RABBITMQ_DEFAULT_PASS:secrets.rabbit});
  add('rg-identity',{KC_DB_PASSWORD:secrets.identity,KC_BOOTSTRAP_ADMIN_USERNAME:'rgadmin',KC_BOOTSTRAP_ADMIN_PASSWORD:secrets.oidcAdmin,'releaseguard-realm.json':JSON.stringify(realm)});
  return {secrets:{apiVersion:'v1',kind:'List',items},metadata:{
   formatVersion:1,planOnly:true,state:'private_inputs_rendered_not_applied',configurationSHA256:createHash('sha256').update(JSON.stringify(config)).digest('hex'),
   checkedAt:new Date(now).toISOString(),privateSecretCount:items.length,
   humanPasswordResetDirectivesIncluded:false,newRandomSecretsOrKeysGenerated:false,providerSecretIncluded:false,
   notVerified:['operator ownership and entropy of supplied material','certificate revocation and complete PKIX policy',
    'actual pinned Keycloak import/client-role claim projection','actual identity provisioning or login',
    'existing resource/realm migration and live TLS connectivity','deployment, availability, scaling or model eligibility'],
   remainingSourceCapability:'Explicit initial secret/certificate/new-realm bootstrap adapter remains separate; never initialize a named person or reset passwords implicitly.',
  }};
 }catch{invalid();}
}

