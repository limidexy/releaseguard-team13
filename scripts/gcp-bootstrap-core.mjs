// New local material preparation protocol. Import is inert. Runtime boundaries
// are injected; the CLI requires explicit execution flags and never applies a realm.
import { X509Certificate,createPrivateKey } from 'node:crypto';
import { validateInfrastructureConfig } from './gcp-infra-core.mjs';
import { renderGcpPrivateInputs } from './gcp-private-core.mjs';
const DAY=86400000,secretNames=['admin','registry','evaluation','governance','identity','rabbit','internal','oidcAdmin','ci','viewer'];
const invalid=()=>{throw Error('Invalid new-material configuration');};
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))invalid();}
export function validateBootstrapConfiguration(input){
 exact(input,['mode','opensslExecutable','infrastructure','identity']);
 if(input.mode!=='new-empty-realm-only'||!['/usr/bin/openssl','/opt/homebrew/opt/openssl@3/bin/openssl'].includes(input.opensslExecutable))invalid();
 const infrastructure=validateInfrastructureConfig(input.infrastructure),i=input.identity;exact(i,['workspace','subjects','servicePrincipals','primarySubject']);
 if(typeof i.workspace!=='string'||!i.workspace||i.workspace.length>100||/[\x00-\x20\x7f]/.test(i.workspace)||!Array.isArray(i.subjects)||!i.subjects.length||i.subjects.length>20)invalid();
 const names=new Set(),subjects=i.subjects.map(s=>{
  exact(s,['username','role']);if(typeof s.username!=='string'||s.username.length>100||!/^[a-zA-Z0-9._@-]+$/.test(s.username)||/^(rgadmin$|service-account-)/i.test(s.username)||!['owner','contributor','reviewer','viewer'].includes(s.role)||names.has(s.username.toLowerCase()))invalid();
  names.add(s.username.toLowerCase());return {...s};
 });
 exact(i.servicePrincipals,['ci','viewer']);
 for(const kind of ['ci','viewer']){
  const s=subjects.find(s=>s.username===i.servicePrincipals[kind]);if(!s||kind==='ci'&&!['owner','contributor'].includes(s.role))invalid();
 }
 if(!subjects.some(s=>s.username===i.primarySubject))invalid();
 return {mode:input.mode,opensslExecutable:input.opensslExecutable,infrastructure,identity:{workspace:i.workspace,subjects,servicePrincipals:{...i.servicePrincipals},primarySubject:i.primarySubject}};
}
export function opensslTime(ms){
 if(!Number.isSafeInteger(ms)||ms<=0)invalid();
 return new Date(ms).toISOString().slice(0,19).replace(/[-:T]/g,'')+'Z';
}
const caConfig='[ca]\ndefault_ca = rg\n[rg]\ndir = .\ndatabase = $dir/index.txt\nnew_certs_dir = $dir/newcerts\ncertificate = $dir/ca.crt\nprivate_key = $dir/ca.key\nserial = $dir/serial\ndefault_md = sha256\ndefault_days = 90\npolicy = policy\nunique_subject = no\ncopy_extensions = none\n[policy]\ncommonName = supplied\n';
const extension=name=>'[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:'+name+',DNS:'+name+'.releaseguard.svc,DNS:'+name+'.releaseguard.svc.cluster.local\n';
function status(raw){
 const codes=['EINVAL','ABORT_ERR','ENOBUFS','ETIMEDOUT','CHILDREN_UNKNOWN','CHILD_TERMINATION_UNKNOWN','ENOENT','EACCES','UNKNOWN'];
 const signals=['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGHUP'];
 return {status:Number.isInteger(raw?.status)&&raw.status>=0?raw.status:null,rawCloseCode:Number.isInteger(raw?.rawCloseCode)?raw.rawCloseCode:null,
  signal:raw?.signal==null?null:signals.includes(raw.signal)?raw.signal:'UNKNOWN',
  error:raw?.error?codes.includes(raw.error.code)?raw.error.code:'UNKNOWN':null,
  truncated:raw?.outputTruncated===true};
}
export async function prepareNewMaterial(input,io){
 let config,sequence=0,phase='configuration',reserved=false,terminalAttempted=false;
 const operations=[];
 try{
  config=validateBootstrapConfiguration(input);
  phase='reservation';await io.reserve();reserved=true;
  async function step(name,fn,args){
   phase=name;const ordinal=++sequence;
   if(io.signal?.aborted)throw Error('stopped');
   await io.intent(ordinal,{name,state:'intent',...(args?{command:config.opensslExecutable,args}:{} )});
   if(io.signal?.aborted)throw Error('stopped');
   const result=await fn();
   await io.result(ordinal,{name,state:'completed',...(result?.observed?{observed:result.observed}:{})});operations.push({name,state:'completed'});
   return result;
  }
  async function command(name,args){
   return step(name,async()=>{
    const raw=await io.command(config.opensslExecutable,args),observed=status(raw);
    await io.observed(sequence,{name,...observed});
    if(observed.status!==0||observed.signal||observed.error||observed.truncated)throw Error('command-not-confirmed');
    return {observed,stdout:typeof raw.stdout==='string'?raw.stdout:''};
   },args);
  }
  await step('initialize-private-files',async()=>{await io.write('openssl-empty.cnf','');});
  const version=await command('openssl-version',['version']);
  if(!/^OpenSSL 3\.\d+\.\d+(?:\s|$)/.test(version.stdout))throw Error('unsupported-openssl');
  let materials;
  await step('new-secrets-and-subject-ids',async()=>{
   const seen=new Set(),newSecret=async()=>{const value=await io.secret();if(!/^[a-f0-9]{72}$/.test(value)||seen.has(value))throw Error('bad-secret');seen.add(value);return value;};
   const secrets={};for(const name of secretNames)secrets[name]=await newSecret();
   const ids=new Set(),passwords={},subjects=[];
   for(const s of config.identity.subjects){
    const id=await io.id(),password=await newSecret();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)||ids.has(id)||!/^[a-f0-9]{72}$/.test(password))throw Error('bad-new-subject');
    ids.add(id);passwords[id]=password;subjects.push({...s,id});
   }
   const lookup=name=>subjects.find(s=>s.username===name).id,primary=lookup(config.identity.primarySubject);
   materials={secrets,subjects,passwords,sourceCompatibleSecrets:{...secrets,human:passwords[primary],humanId:primary},
    identity:{workspace:config.identity.workspace,subjects,servicePrincipals:{ci:lookup(config.identity.servicePrincipals.ci),viewer:lookup(config.identity.servicePrincipals.viewer)}}};
   await io.write('materials.json',JSON.stringify(materials,null,2)+'\n');
  });
  let caStartBefore;
  await step('prepare-ca-state',async()=>{
   await io.mkdir('newcerts');await io.write('ca.cnf',caConfig);await io.write('index.txt','');
   const serial=await io.serial();if(!/^[1-7][a-f0-9]{31}$/.test(serial))throw Error('bad-serial');
   await io.write('serial',serial+'\n');
   for(const name of ['postgres','rabbitmq'])await io.write(name+'.ext',extension(name));
  });
  caStartBefore=io.wallTime();
  await command('issue-ca',['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-keyout','ca.key','-out','ca.crt','-days','90','-subj','/CN=ReleaseGuard Trial Internal CA',
   '-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
  const ca=new X509Certificate(await io.read('ca.crt')),caKey=createPrivateKey(await io.read('ca.key')),caFrom=Date.parse(ca.validFrom),caTo=Date.parse(ca.validTo),after=io.wallTime();
  if(!ca.ca||!ca.verify(ca.publicKey)||ca.publicKey.asymmetricKeyType!=='rsa'||ca.publicKey.asymmetricKeyDetails.modulusLength<3072||
    !ca.checkPrivateKey(caKey)||caKey.asymmetricKeyType!=='rsa'||caKey.asymmetricKeyDetails.modulusLength<3072||
    caTo-caFrom!==90*DAY||after<caStartBefore||caFrom<Math.floor(caStartBefore/1000)*1000||caFrom>Math.floor(after/1000)*1000)throw Error('invalid-issued-ca');
  for(const name of ['postgres','rabbitmq']){
   await command('request-'+name,['req','-newkey','rsa:2048','-nodes','-sha256','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+name]);
   const now=io.wallTime();
   if(now<caFrom||now>=caTo)throw Error('clock-or-ca-window');
   // New issuance uses actual current time and the already-issued CA expiry.
   // No old certificate or system clock is rewritten to make validation pass.
   await command('issue-'+name,['ca','-batch','-config','ca.cnf','-in',name+'.csr','-out',name+'.crt',
    '-startdate',opensslTime(now),'-enddate',opensslTime(caTo),'-notext','-md','sha256','-extensions','server','-extfile',name+'.ext']);
  }
  await step('validate-and-build-private-plans',async()=>{
   const tls={ca:await io.read('ca.crt')};
   for(const name of ['postgres','rabbitmq']){
    tls[name]={certificate:await io.read(name+'.crt'),key:await io.read(name+'.key')};
    const cert=new X509Certificate(tls[name].certificate);
    if(cert.publicKey.asymmetricKeyType!=='rsa'||cert.publicKey.asymmetricKeyDetails.modulusLength<2048)throw Error('invalid-issued-server');
   }
   const prepared={infrastructure:config.infrastructure,secrets:materials.secrets,tls,identity:materials.identity};
   const normal=renderGcpPrivateInputs(prepared,io.wallTime());
   await io.write('private-input.json',JSON.stringify(prepared,null,2)+'\n');
   await io.write('secrets-existing-subjects.json',JSON.stringify(normal.secrets,null,2)+'\n');
   const bootstrap=structuredClone(normal.secrets),secret=bootstrap.items.find(s=>s.metadata.name==='rg-identity'),realm=JSON.parse(secret.stringData['releaseguard-realm.json']);
   for(const user of realm.users){user.credentials=[{type:'password',value:materials.passwords[user.id],temporary:true}];user.requiredActions=['UPDATE_PASSWORD'];}
   secret.stringData['releaseguard-realm.json']=JSON.stringify(realm);
   await io.write('secrets-new-realm-only.json',JSON.stringify(bootstrap,null,2)+'\n');
  });
  phase='final-evidence';if(io.signal?.aborted)throw Error('stopped');const files=await io.inventory();
  if(io.signal?.aborted)throw Error('stopped');
  const result={formatVersion:1,state:'new_material_prepared_not_applied',planOnly:true,newEmptyRealmAssertionIsNotProof:true,
   existingUserPasswordResetAuthorized:false,identityServerContacted:false,providerEnabled:false,requestedCAKeyBits:3072,requestedServerKeyBits:2048,
   caWindowDays:90,serverExpiryBound:'actual CA notAfter',operations,files,
   notVerified:['trusted OpenSSL binary/runtime compatibility','operational entropy or vendor trust','actual Keycloak/new-empty-realm state, import and token projection','live TLS, deployment, existing resource/realm migration, HA or scaling']};
  terminalAttempted=true;await io.terminal(result);return result;
 }catch{
  if(io.reservationOwned===true)reserved=true;
  const result={formatVersion:1,state:reserved?'failed_or_unknown_retained':'refused_before_reservation',phase,planOnly:true,operations,resumeAllowed:false,retryAllowed:false};
  if(reserved&&terminalAttempted)return {...result,evidenceState:'terminal_persistence_unknown'};
  if(reserved){terminalAttempted=true;try{await io.terminal(result);}catch{return {...result,evidenceState:'terminal_persistence_unknown'};}}
  return result;
 }
}

