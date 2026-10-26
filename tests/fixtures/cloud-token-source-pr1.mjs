export async function cloudToken(clientId=process.env.OIDC_CLIENT_ID, clientSecret=process.env.OIDC_CLIENT_SECRET) {
  const issuer=process.env.AUTH_ISSUER, origin=new URL(process.env.RELEASEGUARD_URL).origin;
  if(!issuer || new URL(issuer).protocol!=='https:' || new URL(issuer).origin!==origin || !(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(',').includes(origin) || !clientId || !clientSecret)throw new Error('Explicit allowed origin and scoped OIDC client required');
  const r=await fetch(issuer+'/protocol/openid-connect/token',{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('OIDC service authentication failed: HTTP '+r.status);
  const body=await r.json();if(!body.access_token||body.token_type?.toLowerCase()!=='bearer')throw new Error('OIDC did not issue a bearer token');
  return body.access_token;
}
