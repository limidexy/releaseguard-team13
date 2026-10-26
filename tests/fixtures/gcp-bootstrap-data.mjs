// Public insecure fixture data. No random generation, network, real subprocess,
// OpenSSL execution or operational CA is used by this injected protocol harness.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { privateFixture,insecureFixtureCAKey } from './gcp-private-data.mjs';
export const epoch=Date.parse('2026-10-27T12:00:00Z'),day=86400000;
const time=ms=>new Date(ms).toISOString().slice(2,19).replace(/[-:T]/g,'')+'Z';
const fixtures=new Map();
export function materialFixture(start=epoch,leafStart=start,end=start+90*day){
 const key=[start,leafStart,end].join('/');
 if(!fixtures.has(key))fixtures.set(key,privateFixture({rsa:true,rsaAll:true,ca:{from:time(start),to:time(start+90*day)},
  postgres:{from:time(leafStart),to:time(end)},rabbitmq:{from:time(leafStart),to:time(end)}}));
 return structuredClone(fixtures.get(key));
}
export function bootstrapConfiguration(){
 const f=materialFixture();return {mode:'new-empty-realm-only',opensslExecutable:'/usr/bin/openssl',infrastructure:f.infrastructure,
  identity:{workspace:'synthetic-workspace',subjects:f.identity.subjects.map(({username,role})=>({username,role})),
   servicePrincipals:{ci:'test-contributor',viewer:'test-reviewer'},primarySubject:'test-contributor'}};
}
export function memoryBoundary(options={}){
 const files=new Map(),events=[],commands=[],terminals=[],controller=new AbortController();let reserved=false,counter=0,ids=0,clock=epoch;
 const fail=(kind,key)=>{if(options.fail?.[0]===kind&&options.fail?.[1]===key)throw Error('PRIVATE_FAILURE_DO_NOT_PRINT');};
 const io={signal:controller.signal,wallTime:()=>clock,
  async reserve(){events.push(['reserve']);fail('reserve',0);assert.equal(reserved,false);reserved=true;},
  async intent(n,v){events.push(['intent',n,v.name]);fail('intent',n);if(options.abortAtIntent===n)controller.abort();},
  async result(n,v){events.push(['result',n,v.name]);fail('result',n);},
  async observed(n,v){events.push(['observed',n,v.status]);fail('observed',n);},
  async secret(){events.push(['secret']);return options.duplicateSecrets?'a'.repeat(72):(++counter).toString(16).padStart(72,'0');},
  async id(){events.push(['id']);return '00000000-0000-4000-8000-'+String(++ids).padStart(12,'0');},
  async serial(){events.push(['serial']);return '1'+'a'.repeat(31);},
  async write(name,value){events.push(['write',name]);fail('write',name);assert.equal(files.has(name),false);files.set(name,value);},
  async read(name){events.push(['read',name]);assert.ok(files.has(name));return files.get(name);},
  async mkdir(name){events.push(['mkdir',name]);},
  async command(exe,args){
   events.push(['command',args[0]]);commands.push({exe,args:[...args]});assert.equal(exe,'/usr/bin/openssl');
   const n=commands.length;if(options.badCommand===n)return {status:options.badStatus??1,rawCloseCode:options.badStatus??1,stderr:'PRIVATE_FAILURE_DO_NOT_PRINT'};
   const f=materialFixture();
   if(args[0]==='version')return {status:0,stdout:options.version??'OpenSSL 3.0.17 TEST ONLY'};
   if(args[0]==='req'&&args.includes('-x509')){
    files.set('ca.crt',f.tls.ca);files.set('ca.key',options.mismatchedCAKey?f.tls.postgres.key:insecureFixtureCAKey());
    if(options.delayIssuance)clock+=2000;
   }else if(args[0]==='req'){
    const name=args[args.indexOf('-out')+1].replace('.csr','');files.set(name+'.key',f.tls[name].key);files.set(name+'.csr','SYNTHETIC CSR PLACEHOLDER - NOT REAL CSR VALIDATION');
   }else if(args[0]==='ca'){
    const name=args[args.indexOf('-out')+1].replace('.crt',''),from=args[args.indexOf('-startdate')+1],to=args[args.indexOf('-enddate')+1];
    const decode=s=>Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(8,10),+s.slice(10,12),+s.slice(12,14));
    files.set(name+'.crt',materialFixture(epoch,decode(from),decode(to)).tls[name].certificate);
   }else assert.fail('Unexpected command');
   return {status:0,stdout:'',stderr:''};
  },
  async inventory(){events.push(['inventory']);fail('inventory',0);if(options.abortAtInventory)controller.abort();return [...files].map(([path,value])=>({path,size:Buffer.byteLength(value),sha256:createHash('sha256').update(value).digest('hex')}));},
  async terminal(v){events.push(['terminal',v.state]);terminals.push(v);fail('terminal',0);},
 };
 return {io,files,events,commands,terminals,controller};
}
