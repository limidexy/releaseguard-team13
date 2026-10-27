import test from 'node:test';
import assert from 'node:assert/strict';
import {gcpEvidenceSource} from './fixtures/gcp-evidence-source-pr1.mjs';
test('frozen source full workflow keeps arithmetic median and all ten archive roles',async()=>{
 const outputs={},copies=[],calls=[];
 const benchmark={at:'2026-10-11T00:00:00Z',sourceCommit:'1'.repeat(40),stages:[{round:1,replicas:1,jobsPerSecond:5},{round:1,replicas:3,jobsPerSecond:12},{round:2,replicas:3,jobsPerSecond:16},{round:2,replicas:1,jobsPerSecond:9}]};
 const original=structuredClone(benchmark);
 const read=async name=>JSON.stringify(name.includes('trial-config')?{project:'synthetic-rg',cluster:'test-cluster',zone:'asia-southeast1-a'}:benchmark);
 const command=(name,args)=>{calls.push({name,args});return JSON.stringify(name==='kubectl'?{items:[]}:args[0]==='container'?{name:'test-cluster',status:'RUNNING',currentNodeCount:0,nodePools:[{name:'default-pool',config:{machineType:'e2-standard-2',diskSizeGb:20}}]}:[]);};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('execFileSync','readFile','writeFile','mkdir','copyFile','process','console',gcpEvidenceSource.replace(/^import .*;\n/gm,''))(command,read,async(name,b)=>{outputs[name]=JSON.parse(b);},async()=>{},async(from,to)=>{copies.push({from,to});},{argv:[],exit:()=>{}},{log:()=>{}});
 const d=outputs['evidence/current/cloud-benchmark-derived.json'];
 assert.deepEqual(d.summaries,[{replicas:1,rounds:2,medianJobsPerSecond:7,minJobsPerSecond:5,maxJobsPerSecond:9},{replicas:3,rounds:2,medianJobsPerSecond:14,minJobsPerSecond:12,maxJobsPerSecond:16}]);
 assert.equal(d.throughputRatio,2);assert.deepEqual(benchmark,original);
 assert.deepEqual(copies.map(x=>x.from.slice('evidence/current/'.length)),['cloud-acceptance.json','cloud-benchmark.json','cloud-benchmark-derived.json','cloud-autoscale.json','cloud-autoscale-first-capacity-failed.json','cloud-autoscale-second-cold-metric-failed.json','cloud-autoscale-worker-pause.json','cloud-backup-restore.json','cloud-power-state.json','prompt-comparison-real-1791722840080.json']);
 assert.equal(calls.length,3);assert.equal(outputs['evidence/current/cloud-power-state.json'].paidUpgradeAuthorized,false);
});
