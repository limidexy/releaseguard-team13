// No applications/release/review/admin/provider route; no real/replay submission.
import { cloudRequest } from './cloud-http.mjs';
import { strictComparisonJSON } from './comparison-files.mjs';
import { retainedId } from './retained-rescore-input.mjs';
export async function retainedRequest(origin,op,token,timeoutMs,signal,fetcher,secrets=[]){
 if(!op||!['GET','POST'].includes(op.method)||op.originHeader!==undefined||op.expectJSON!==undefined||
  !(op.method==='GET'&&op.route?.startsWith('/jobs/')&&retainedId(op.route.slice(6))&&op.body===undefined&&op.key===undefined||
   op.method==='POST'&&op.route==='/suites'&&retainedId(op.body?.parentId)&&op.key===undefined||
   op.method==='POST'&&op.route==='/jobs'&&op.body?.source==='imported'&&Array.isArray(op.body.outputs)&&op.body.outputs.length<=10&&typeof op.key==='string'))throw Error('Retained route refused');
 const r=await cloudRequest(origin,{...op,route:'/api/v2'+op.route},token,timeoutMs,signal,fetcher,secrets);
 if(r.code==='response_received'&&r.bodyComplete&&r.rawEntityBase64!==null){try{r.body=strictComparisonJSON(Buffer.from(r.rawEntityBase64,'base64'));}
  catch{r.body=null;r.code='ambiguous_or_invalid_json';}}
 return r;
}
