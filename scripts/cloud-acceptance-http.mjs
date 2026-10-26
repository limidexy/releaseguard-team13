// Closed acceptance route/auth table; no general review client or automatic retry.
import { cloudRequest } from './cloud-http.mjs';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const routes={
 anonymous:['GET',/^applications$/,null],tampered:['GET',/^applications$/,'tampered'],viewer:['POST',/^applications$/,'viewer'],
 application:['POST',/^applications$/,'contributor'],suite:['POST',/^suites$/,'contributor'],submit:['POST',/^jobs$/,'contributor'],duplicate:['POST',/^jobs$/,'contributor'],
 observe:['GET',new RegExp('^jobs/'+uuid+'$'),'contributor'],release:['POST',/^releases$/,'contributor'],
 before:['GET',new RegExp('^evidence/'+uuid+'$'),'contributor'],after:['GET',new RegExp('^evidence/'+uuid+'$'),'contributor'],
 deniedReview:['POST',new RegExp('^releases/'+uuid+'/review$'),'contributor'],crossOrigin:['POST',/^applications$/,'contributor'],admin:['GET',/^auth\/admin\/$/,null],
};
export function acceptanceRequest(origin,op,credentials,timeoutMs,signal,fetcher,allowNegativeProbe){
 const def=routes[op?.name],valid=def&&op.method===def[0]&&def[1].test(op.path)&&
  (op.name!=='deniedReview'||allowNegativeProbe===true&&op.body?.decision==='approved'&&op.body.version===1&&op.body.note==='Automated negative authorization check');
 if(!valid)return cloudRequest('',{},null,timeoutMs,signal,fetcher);
 return cloudRequest(origin,{route:op.name==='admin'?'/auth/admin/':'/api/v2/'+op.path,method:op.method,body:op.body,key:op.key,
  ...(op.name==='crossOrigin'?{originHeader:'https://untrusted.invalid'}:{}),expectJSON:op.name!=='admin'},def[2]===null?null:credentials[def[2]],timeoutMs,signal,fetcher,[credentials.contributor,credentials.viewer,...(credentials.selectedClientSecrets??[])]);
}
