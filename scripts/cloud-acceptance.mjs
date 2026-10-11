import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { application, suite } from './fixtures.mjs';
import { base, request, required, completed, key } from './client.mjs';
import { cloudToken } from './cloud-token.mjs';
if(process.env.RG_ALLOW_CLOUD_SMOKE!=='true'||new URL(base).protocol!=='https:'||!(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(',').includes(new URL(base).origin))throw Error('Explicit approved HTTPS trial target required');
const checks=[],report={at:new Date().toISOString(),origin:base,cloud:true,identity:'Keycloak RS256 client credentials, service=true; NOT a human approval',commit:process.env.RG_COMMIT,checks};
const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log('PASS',name);}catch(e){checks.push({name,passed:false,error:String(e)});throw e;}};
try {
 const t=await cloudToken(),viewer=await cloudToken('rg-viewer',process.env.OIDC_VIEWER_SECRET);
 await check('Unauthenticated API is rejected',async()=>assert.equal((await request('applications','')).status,401));
 await check('Tampered JWT is rejected',async()=>{const a=t.split('.');a[2]=(a[2][0]==='a'?'b':'a')+a[2].slice(1);assert.equal((await request('applications',a.join('.'))).status,401)});
 await check('Viewer cannot write',async()=>assert.equal((await request('applications',viewer,application)).status,403));
 const app=await required('applications',t,{...application,name:'Cloud acceptance '+Date.now()}),s=await required('suites',t,suite);
 const payload={appId:app.id,suiteId:s.id,candidate:'acceptance',commitRef:process.env.RG_COMMIT??'cloud-trial',source:'replay'},k=key();
 const q=await required('jobs',t,payload,k),q2=await required('jobs',t,payload,k);
 await check('Duplicate submission returns the same job',async()=>assert.equal(q.id,q2.id));
 const j=await completed(q.id,t);report.jobId=j.id;
 await check('Ten-case replay executes and gate passes',async()=>{assert.equal(j.status,'succeeded');assert.equal(j.result.gate,'passed');assert.equal(j.result.results.length,10)});
 const release=await required('releases',t,{jobId:j.id,note:'Automated trial acceptance; pending independent human review.'});report.releaseId=release.id;
 await check('Service identity cannot approve a release',async()=>assert.equal((await request('releases/'+release.id+'/review',t,{decision:'approved',version:1,note:'Automated negative authorization check'})).status,403));
 await check('Audit evidence remains pending, not fabricated approval',async()=>{const e=await required('evidence/'+release.id,t);assert.equal(e.release.status,'pending');assert.equal(e.release.reviewed_by,null);assert.equal(e.audit[0].action,'ReleaseRequested')});
 await check('Cross-origin mutation rejected',async()=>{const r=await fetch(base+'/api/v2/applications',{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json',origin:'https://untrusted.invalid'},body:JSON.stringify(application),signal:AbortSignal.timeout(15000)});assert.equal(r.status,403)});
 await check('Public identity administration is blocked',async()=>{const r=await fetch(base+'/auth/admin/',{redirect:'manual',signal:AbortSignal.timeout(15000)});assert.equal(r.status,404)});
 report.passed=true;
}catch(e){report.passed=false;report.error=String(e);process.exitCode=1;}
finally{await mkdir('evidence/current',{recursive:true});await writeFile('evidence/current/cloud-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:checks.length}));}
