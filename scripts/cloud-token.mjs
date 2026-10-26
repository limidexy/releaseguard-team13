// Inactive service-client token adapter, equivalent capability to source PR1
// cloudToken, but callers must deliberately supply a complete configuration:
// {allowServiceAuthentication:true,targetOrigin,allowedOrigins:[...],issuer,
//  clientId,clientSecret,timeoutMs:15000}. No implicit environment/.env discovery.
// Credentials belong in memory from the authorized caller, never CLI/URL/logs.
// There is no automatic login, token refresh/cache/retry, role grant or caller
// activation here. Future cloud consumers must check their own opt-in/target
// and persist their attempt BEFORE calling this helper. Current CI uses fakes.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { requestServiceToken } from './cloud-token-core.mjs';
export async function cloudToken(config,runtime={fetch:globalThis.fetch}){
 return requestServiceToken(config,runtime);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 console.error('Import-only service authentication adapter. No credential arguments, environment fallback or automatic request.');process.exitCode=1;
}
