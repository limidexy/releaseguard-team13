import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const c=JSON.parse(await readFile('deploy/gcp/trial-config.json','utf8'));
const g=(...a)=>JSON.parse(execFileSync('gcloud',[...a,'--project='+c.project,'--format=json'],{encoding:'utf8',timeout:60000}));
const root='evidence/current';await mkdir(root,{recursive:true});
const cluster=g('container','clusters','describe',c.cluster,'--zone='+c.zone);
const nodes=g('compute','instances','list','--filter=name~^gke-rg-trial-');
const pvcs=JSON.parse(execFileSync('kubectl',['-n','releaseguard','get','pvc','-o','json'],{encoding:'utf8',timeout:60000})).items;
const report={at:new Date().toISOString(),project:c.project,cluster:cluster.name,zone:c.zone,status:cluster.status,currentNodeCount:cluster.currentNodeCount??0,nodePools:cluster.nodePools.map(p=>({name:p.name,machineType:p.config.machineType,diskSizeGb:p.config.diskSizeGb,autoscaling:p.autoscaling??null})),instances:nodes.map(n=>({name:n.name,status:n.status,zone:n.zone.split('/').at(-1)})),computeStopped:nodes.length===0,dataVolumes:pvcs.map(p=>({name:p.metadata.name,status:p.status.phase,capacity:p.status.capacity})),paidUpgradeAuthorized:false,warning:'Zero compute nodes does not stop storage, static IP, load balancer, registry or other retained-resource credit consumption. Billing data can lag.'};
await writeFile(root+'/cloud-power-state.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
// Routine power checks must not overwrite the immutable earlier experiment archive.
if(process.argv.includes('--power-only'))process.exit(0);
// Keep original observations intact. Correct only the aggregate median in a
// separate derivation with an explicit provenance note.
const b=JSON.parse(await readFile(root+'/cloud-benchmark.json','utf8'));
const median=a=>{const s=a.toSorted((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
const summaries=[1,3].map(replicas=>{const s=b.stages.filter(x=>x.replicas===replicas);return{replicas,rounds:s.length,medianJobsPerSecond:median(s.map(x=>x.jobsPerSecond)),minJobsPerSecond:Math.min(...s.map(x=>x.jobsPerSecond)),maxJobsPerSecond:Math.max(...s.map(x=>x.jobsPerSecond))}});
await writeFile(root+'/cloud-benchmark-derived.json',JSON.stringify({at:new Date().toISOString(),source:'cloud-benchmark.json',observedAt:b.at,sourceCommit:b.sourceCommit,derivation:'Arithmetic mean of the two central observations for even-count median. No new execution or changed raw observation. Original .5 nearest-rank aggregate was not the usual even-count median.',summaries,throughputRatio:summaries[1].medianJobsPerSecond/summaries[0].medianJobsPerSecond,limitations:'Two short paired rounds only; no stable, proportional or sustained scaling claim.'},null,2));
const out='docs/evidence/cloud-2026-10-11';await mkdir(out,{recursive:true});
for(const name of ['cloud-acceptance.json','cloud-benchmark.json','cloud-benchmark-derived.json','cloud-autoscale.json','cloud-autoscale-first-capacity-failed.json','cloud-autoscale-second-cold-metric-failed.json','cloud-autoscale-worker-pause.json','cloud-backup-restore.json','cloud-power-state.json','prompt-comparison-real-1791722840080.json'])await copyFile(root+'/'+name,out+'/'+name);
