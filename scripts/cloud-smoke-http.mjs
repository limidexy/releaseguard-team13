// Narrow smoke routes remain unchanged; acceptance uses its own separate guard.
import { cloudRequest } from './cloud-http.mjs';
export async function smokeRequest(origin,op,token,timeoutMs,signal,fetcher){
 const valid=op&&(['applications','suites','jobs'].includes(op.path)||/^jobs\/[0-9a-f-]{36}$/.test(op.path))&&['POST','GET'].includes(op.method)&&((op.method==='GET')===op.path.startsWith('jobs/'))&&typeof token==='string';
 if(!valid)return cloudRequest('',{},null,timeoutMs,signal,fetcher);
 return cloudRequest(origin,{route:'/api/v2/'+op.path,method:op.method,body:op.body,key:op.key},token,timeoutMs,signal,fetcher);
}
