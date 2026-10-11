import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const c=JSON.parse(await readFile('deploy/gcp/trial-config.json','utf8'));
const s=JSON.parse(await readFile('evidence/private/gcp/secrets.json','utf8'));
const gh=process.env.GH_BINARY??'gh',repo='limidexy/releaseguard-team13';
const vars={PUBLIC_ORIGIN:c.PUBLIC_ORIGIN,AUTH_ISSUER:c.PUBLIC_ORIGIN+'/auth/realms/releaseguard',OIDC_JWKS_URL:c.PUBLIC_ORIGIN+'/auth/realms/releaseguard/protocol/openid-connect/certs',GCP_PROJECT_ID:c.project,GCP_IMAGE_REPOSITORY:c.registry,GCP_WORKLOAD_IDENTITY_PROVIDER:'projects/173994707196/locations/global/workloadIdentityPools/rg-github/providers/github',GCP_DEPLOY_SERVICE_ACCOUNT:'rg-github-deploy@'+c.project+'.iam.gserviceaccount.com',RG_ENABLE_CLOUD_CD:'true'};
for(const [name,value] of Object.entries(vars))execFileSync(gh,['variable','set',name,'--repo',repo,'--body',value],{stdio:'pipe'});
execFileSync(gh,['secret','set','OIDC_CI_SECRET','--repo',repo],{input:s.ci,stdio:['pipe','pipe','pipe']});
console.log('Repository variables and scoped smoke-test secret configured. No cloud service-account key created.');
