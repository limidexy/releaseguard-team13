// Only the original benchmark app/suite/replay/job/history routes. No real model,
// output import, release, review, admin, arbitrary query or credential fallback.
import {cloudRequest} from './cloud-http.mjs';
import {strictComparisonJSON} from './comparison-files.mjs';
import {retainedId} from './retained-rescore-input.mjs';
const plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
export async function benchmarkRequest(origin,op,token,timeoutMs,signal,fetcher,secrets=[]){
 if(!plain(op)||Object.keys(op).some(k=>!['method','route','body','key','offset'].includes(k))||!['GET','POST'].includes(op.method)||typeof token!=='string')throw Error('Benchmark route refused');
 const post=op.method==='POST',history=op.method==='GET'&&op.route==='/jobs'&&[0,25,50,75].includes(op.offset);
 const jobRead=op.method==='GET'&&op.route?.startsWith('/jobs/')&&retainedId(op.route.slice(6))&&op.offset===undefined;
 const create=post&&['/applications','/suites','/jobs'].includes(op.route)&&plain(op.body)&&op.offset===undefined;
 if(!(history||jobRead||create)||!post&&(op.body!==undefined||op.key!==undefined)||post&&op.route!=='/jobs'&&op.key!==undefined)throw Error('Benchmark route refused');
 if(post&&op.route==='/jobs'&&(op.body.source!=='replay'||Object.keys(op.body).some(k=>!['appId','suiteId','candidate','commitRef','source','promptVersion','scenario'].includes(k))||
  !retainedId(op.body.appId)||!retainedId(op.body.suiteId)||op.body.promptVersion!==undefined&&op.body.promptVersion!=='v1'||op.body.scenario!==undefined&&op.body.scenario!=='passing'||typeof op.key!=='string'))throw Error('Benchmark replay refused');
 if(post&&op.route==='/suites'&&(!Array.isArray(op.body.cases)||op.body.cases.length!==10||op.body.policy?.minScore!==95||op.body.parentId!==undefined))throw Error('Benchmark suite refused');
 const request={route:'/api/v2'+op.route,method:op.method,...(post?{body:op.body}:{}),...(op.key?{key:op.key}:{}),...(history?{query:'limit=25&offset='+op.offset}:{})};
 const r=await cloudRequest(origin,request,token,timeoutMs,signal,fetcher,secrets);
 if(r.code==='response_received'&&r.bodyComplete&&r.rawEntityBase64!==null){try{r.body=strictComparisonJSON(Buffer.from(r.rawEntityBase64,'base64'));}
  catch{r.body=null;r.code='ambiguous_or_invalid_json';}}
 return r;
}
