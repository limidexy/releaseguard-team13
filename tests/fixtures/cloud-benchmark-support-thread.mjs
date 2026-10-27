// Owned in-process thread, no listener/provider/DB. Separate service-role module
// cache permits actual Worker->Support JWT audience/caller verification.
import {parentPort,workerData} from 'node:worker_threads';
import net from 'node:net';
if(!parentPort||workerData?.fixture!=='cloud-benchmark-support')throw Error('Owned test thread only');
net.Socket.prototype.connect=()=>{throw Error('Native TCP forbidden');};net.Server.prototype.listen=()=>{throw Error('Native listener forbidden');};
globalThis.fetch=()=>{throw Error('Provider or external fetch forbidden');};
Object.assign(process.env,{SERVICE_ROLE:'support',AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:workerData.secret,INTERNAL_SECRET:workerData.secret,DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked'});delete process.env.AUTH_ISSUER;
const common=await import('../../dist/src/common.js'),{support}=await import('../../dist/src/support.js'),app=common.server();app.log.level='silent';await support(app);
parentPort.on('message',async({id,headers,payload})=>{
 try{const r=await app.inject({method:'POST',url:'/execute',headers,payload});parentPort.postMessage({id,status:r.statusCode,body:r.body});}
 catch{parentPort.postMessage({id,status:503,body:'{"error":"synthetic thread failed"}'});}
});
parentPort.postMessage({ready:true});
