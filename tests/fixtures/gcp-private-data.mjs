// Deliberately public, insecure scalar values 1/2/3 are TEST DATA, never operational keys.
// No random/key-pair generation or external OpenSSL is used. Only synthetic certificates
// are signed in memory so the real X509 parser/chain/name/key checks can be exercised.
import { createECDH, createPrivateKey, createPublicKey, getDiffieHellman, sign } from 'node:crypto';
const B=Buffer;
function tlv(tag,bytes){const n=bytes.length,len=n<128?B.from([n]):n<256?B.from([0x81,n]):B.from([0x82,n>>8,n&255]);return B.concat([B.from([tag]),len,bytes]);}
const seq=(...v)=>tlv(0x30,B.concat(v)),set=(...v)=>tlv(0x31,B.concat(v));
function oid(text){const p=text.split('.').map(Number),out=[40*p[0]+p[1]];for(let n of p.slice(2)){const a=[n&127];while(n=Math.floor(n/128))a.unshift((n&127)|128);out.push(...a);}return tlv(6,B.from(out));}
const name=text=>seq(set(seq(oid('2.5.4.3'),tlv(12,B.from(text)))));
const alg=k=>k.asymmetricKeyType==='rsa'?seq(oid('1.2.840.113549.1.1.11'),tlv(5,B.alloc(0))):seq(oid('1.2.840.10045.4.3.2'));
const pem=(label,bytes)=>'-----BEGIN '+label+'-----\n'+bytes.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END '+label+'-----\n';
function key(scalar){const d=B.alloc(32);d[31]=scalar;const ec=createECDH('prime256v1');ec.setPrivateKey(d);const p=ec.getPublicKey();return createPrivateKey({format:'jwk',key:{kty:'EC',crv:'P-256',d:d.toString('base64url'),x:p.subarray(1,33).toString('base64url'),y:p.subarray(33).toString('base64url')}});}
// RSA factors are public standardized DH primes (or literal3 for the weak-key
// rejection case), NOT private/random primes. Never use this material operationally.
function rsa(pGroup,qGroup){
 const prime=g=>typeof g==='bigint'?g:BigInt('0x'+getDiffieHellman(g).getPrime('hex'));
 const p=prime(pGroup),q=prime(qGroup),phi=(p-1n)*(q-1n),e=65537n;
 function inverse(a,m){let [r,n,t,u]=[a,m,1n,0n];while(n){const z=r/n;[r,n]=[n,r-z*n];[t,u]=[u,t-z*u];}if(r!==1n)throw Error('Bad public RSA fixture');return (t%m+m)%m;}
 const d=inverse(e,phi),bytes=x=>B.from((x.toString(16).length%2?'0':'')+x.toString(16),'hex').toString('base64url');
 return createPrivateKey({format:'jwk',key:Object.fromEntries(Object.entries({kty:'RSA',n:p*q,e,d,p,q,dp:d%(p-1n),dq:d%(q-1n),qi:inverse(q,p)}).map(([k,v])=>[k,typeof v==='bigint'?bytes(v):v]))});
}
function cert({subject,issuer,publicKey,signingKey,serial=1,isCA=false,hosts=[],serverAuth=true,from='240101000000Z',to='340101000000Z'}){
 const exts=[seq(oid('2.5.29.19'),tlv(1,B.from([255])),tlv(4,isCA?seq(tlv(1,B.from([255]))):seq()))];
 if(hosts.length)exts.push(seq(oid('2.5.29.17'),tlv(4,seq(...hosts.map(h=>tlv(0x82,B.from(h)))))));
 if(!isCA)exts.push(seq(oid('2.5.29.37'),tlv(4,seq(oid(serverAuth?'1.3.6.1.5.5.7.3.1':'1.3.6.1.5.5.7.3.2')))));
 const tbs=seq(tlv(0xa0,tlv(2,B.from([2]))),tlv(2,B.from([serial])),alg(signingKey),name(issuer),seq(tlv(23,B.from(from)),tlv(23,B.from(to))),name(subject),createPublicKey(publicKey).export({format:'der',type:'spki'}),tlv(0xa3,seq(...exts)));
 return pem('CERTIFICATE',seq(tbs,alg(signingKey),tlv(3,B.concat([B.from([0]),sign('sha256',tbs,signingKey)]))));
}
export function privateFixture(options={}){
 const caKey=options.rsa?rsa('modp2','modp14'):key(options.caScalar??1),pgKey=options.pgUsesCAKey?caKey:options.weakRSA?rsa('modp1',3n):options.rsa?rsa('modp2','modp15'):key(2),rabbitKey=options.sharedLeafKey?pgKey:key(3),caName='INSECURE TEST ONLY CA';
 const hosts=name=>[name,name+'.releaseguard.svc',name+'.releaseguard.svc.cluster.local'];
 const ca=cert({subject:caName,issuer:caName,publicKey:caKey,signingKey:caKey,isCA:true});
 const leaf=(name,k,opts={})=>({certificate:cert({subject:name,issuer:caName,publicKey:k,signingKey:caKey,serial:name==='postgres'?2:3,hosts:hosts(name),...opts}),key:k.export({format:'pem',type:'pkcs8'}).toString()});
 const input={
  infrastructure:{publicOrigin:'https://releaseguard.example.test',publicIP:'203.0.113.10',podCIDR:'10.44.0.0/16',clockSkewBoundMs:137,
   images:Object.fromEntries(['postgres','rabbitmq','identity','edge'].map((name,i)=>[name,'example.test/'+name+'@sha256:'+String.fromCharCode(97+i).repeat(64)]))},
  secrets:Object.fromEntries(['admin','registry','evaluation','governance','identity','rabbit','internal','oidcAdmin','ci','viewer'].map(name=>[name,'INSECURE_TEST_ONLY_'+name+'_'+ 'x'.repeat(40)])),
  tls:{ca,postgres:leaf('postgres',pgKey,options.postgres),rabbitmq:leaf('rabbitmq',rabbitKey,options.rabbitmq)},
  identity:{workspace:'synthetic-workspace',subjects:[{id:'00000000-0000-4000-8000-000000000001',username:'test-contributor',role:'contributor'},{id:'00000000-0000-4000-8000-000000000002',username:'test-reviewer',role:'reviewer'}],
    servicePrincipals:{ci:'00000000-0000-4000-8000-000000000001',viewer:'00000000-0000-4000-8000-000000000002'}},
 };
 return input;
}

