import http from 'node:http';
import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ORIGIN='https://rg-team13.34.21.137.20.sslip.io';
export const CLIENT='releaseguard-browser';
export const REDIRECT='http://127.0.0.1:8765/callback';
const issuer=ORIGIN+'/auth/realms/releaseguard';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function verifyPersonalJwt(token,keys,{audience,issuer:expectedIssuer,nonce,now=Math.floor(Date.now()/1000)}){
 const parts=token.split('.');if(parts.length!==3)throw Error('Malformed token');
 const decode=x=>JSON.parse(Buffer.from(x,'base64url').toString('utf8'));
 const header=decode(parts[0]),payload=decode(parts[1]);
 if(header.alg!=='RS256')throw Error('Unexpected token signing algorithm');
 const matches=keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));
 if(matches.length!==1||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:matches[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('Invalid signature');
 if(payload.iss!==expectedIssuer||!([].concat(payload.aud??[]).includes(audience))||!Number.isFinite(payload.exp)||payload.exp<=now||payload.nbf>now+5||!payload.sub)throw Error('Invalid token issuer, audience, subject or lifetime');
 if(nonce!==undefined&&payload.nonce!==nonce)throw Error('Invalid login nonce');
 return payload;
}
export function verifyActor(access,id,username){
 if(access.sub!==id.sub||id.preferred_username!==username||!['contributor','reviewer'].includes(access.role)||access.service!==false||access.workspace!=='team13-cloud')throw Error('Unexpected individual identity, workspace or role');
 return {username:id.preferred_username,role:access.role,workspace:access.workspace,personal:true};
}
export async function startPersonalLogin(username,{fetchImpl=fetch,port=8765,onVerified=()=>{}}={}){
 if(!/^[a-z0-9._-]{1,64}$/.test(username??''))throw Error('Supply your own username: xinda / liaobinfeng / liaocan');
 if(port!==8765)throw Error('The registered loopback callback uses port 8765');
 const getJson=async url=>{const r=await fetchImpl(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('Identity metadata HTTP '+r.status);return r.json();};
 const metadata=await getJson(issuer+'/.well-known/openid-configuration');
 if(metadata.issuer!==issuer||![metadata.authorization_endpoint,metadata.token_endpoint,metadata.jwks_uri].every(v=>{const u=new URL(v);return u.origin===ORIGIN&&u.pathname.startsWith('/auth/realms/releaseguard/');}))throw Error('Unexpected identity provider endpoints');
 const keys=(await getJson(metadata.jwks_uri)).keys;
 const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
 const auth=new URL(metadata.authorization_endpoint);auth.search=new URLSearchParams({client_id:CLIENT,redirect_uri:REDIRECT,response_type:'code',scope:'openid',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',login_hint:username,prompt:'login'});
 let attempted=false;
 const page=(res,status,body)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>ReleaseGuard 个人登录</title><body style="font:17px system-ui;max-width:850px;margin:50px auto;line-height:1.8">'+body+'</body></html>');};
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.host!=='127.0.0.1:8765'||req.method!=='GET')return page(res,400,'无效的本机请求。');
   const u=new URL(req.url,'http://127.0.0.1:8765');
   if(u.pathname==='/')return page(res,200,'<h1>ReleaseGuard 个人登录</h1><p>账号：'+escape(username)+'</p><p>仅本人输入密码。不要使用或分享管理员、CI 或其他人的令牌。</p><p><a href="/start">开始本人登录 / Sign in</a></p><p>云环境停止时登录不可用。此助手不会启动、停止节点或调用模型。</p>');
   if(u.pathname==='/start'){if(attempted)return page(res,409,'本次登录已处理。');res.writeHead(302,{location:auth.href,'cache-control':'no-store','referrer-policy':'no-referrer'});return res.end();}
   if(u.pathname!=='/callback')return page(res,404,'页面不存在。');
   if(attempted||u.searchParams.get('state')!==state)return page(res,400,'登录状态错误或已使用。');
   attempted=true;
   if(u.searchParams.has('error')||!u.searchParams.get('code'))throw Error('Personal login was not completed');
   const r=await fetchImpl(metadata.token_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:CLIENT,redirect_uri:REDIRECT,code:u.searchParams.get('code'),code_verifier:verifier}),signal:AbortSignal.timeout(15000),redirect:'error'});
   if(!r.ok)throw Error('Authorization code exchange HTTP '+r.status);
   const data=await r.json();
   const access=verifyPersonalJwt(data.access_token,keys,{issuer,audience:'releaseguard'}),id=verifyPersonalJwt(data.id_token,keys,{issuer,audience:CLIENT,nonce});
   const actor=verifyActor(access,id,username);const checks=[];
   for(const route of ['jobs?limit=1&offset=0','releases']){const rr=await fetchImpl(ORIGIN+'/api/v2/'+route,{headers:{authorization:'Bearer '+data.access_token},signal:AbortSignal.timeout(15000),redirect:'error'});checks.push({route,status:rr.status});await rr.arrayBuffer();}
   if(checks.some(c=>c.status!==200))throw Error('Personal workspace read access failed');
   onVerified({at:new Date().toISOString(),...actor,checks});
   page(res,200,'<h1>个人登录已验证 / Signed in</h1><p>'+escape(actor.username)+' / '+escape(actor.role)+'</p><p>以下是<strong>你本人</strong>的短期访问令牌，到期时间 '+escape(new Date(access.exp*1000).toISOString())+'。只粘贴到下方指定的 ReleaseGuard 网页，不发送给他人、不截图、不上传 Git。</p><textarea readonly rows="7" style="width:100%" aria-label="Your personal access token">'+escape(data.access_token)+'</textarea><p>全选上框复制 → <a href="'+ORIGIN+'" target="_blank" rel="noreferrer">打开 ReleaseGuard</a> → 填入“访问令牌” → “刷新工作空间”。</p><p>完成后清空网页令牌并关闭本页和助手。此助手不写入密码或令牌文件、不审批、不调用模型，也不自动停机。</p>');
  }catch(e){page(res,400,'<h1>登录未完成</h1><p>'+escape(e.message)+'</p><p>不要发送密码或令牌；请报告这里的错误名称。云环境停止时先联系维护人。</p>');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const expiry=setTimeout(()=>server.close(),15*60*1000);expiry.unref();server.on('close',()=>clearTimeout(expiry));
 return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const server=await startPersonalLogin(process.argv[2],{onVerified:r=>console.log('LOGIN_VERIFIED',JSON.stringify(r))});console.log('Open http://127.0.0.1:8765 in your own browser. This helper never asks for admin/cloud/model credentials.');process.on('SIGINT',()=>server.close());}
 catch(e){console.error('Personal login unavailable:',e.message);process.exitCode=1;}
}
