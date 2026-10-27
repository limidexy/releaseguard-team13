// Closed comparison routes: no release/review/admin/provider operation.
import { cloudRequest } from './cloud-http.mjs';
export async function comparisonRequest(origin,op,token,timeoutMs,signal,fetcher,knownSecrets=[]){
 if(!op||!(op.method==='POST'&&['/applications','/suites','/jobs'].includes(op.route)||
  op.method==='GET'&&/^\/jobs\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(op.route)))throw Error('Comparison route refused');
 if(op.method==='GET'&&(op.body!==undefined||op.key!==undefined)||op.originHeader!==undefined||op.expectJSON!==undefined)throw Error('Comparison operation refused');
 return cloudRequest(origin,{...op,route:'/api/v2'+op.route},token,timeoutMs,signal,fetcher,knownSecrets,{allowExplicitLoopback:true});
}
