import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../scripts/comparison-files.mjs';
import {validateEvidenceConfiguration,validateEvidenceSource,validateEvidenceKubeconfig,deriveEvidenceBenchmark,evidenceCommand,collectEvidencePower,runEvidenceProtocol} from '../scripts/gcp-evidence-core.mjs';
import {fixtureConfig,records,kubeconfig,cloudFixtures} from './fixtures/gcp-evidence-data.mjs';
const base='/synthetic-owned-root';
const normal=()=>fixtureConfig(base);
test('full offline plan accepts all nine originals and rejects missing failed artifact instead of archiving a successful subset',()=>{
 const c=normal();assert.equal(Object.keys(validateEvidenceConfiguration(c).sources).length,9);delete c.sources['cloud-autoscale-first-capacity-failed.json'];assert.throws(()=>validateEvidenceConfiguration(c));
});
for(const [label,mutate]of [
 ['unknown field',c=>{c.retry=1;}],['invalid run',c=>{c.runId='../old';}],['deadline overflow',c=>{c.deadlineMs=600001;}],
 ['path reuse',c=>{c.sources['cloud-acceptance.json'].path=c.sources['cloud-benchmark.json'].path;}],['relative path',c=>{c.sources['cloud-acceptance.json'].path='old.json';}],
 ['wrong hash',c=>{c.sources['cloud-acceptance.json'].sha256='old';}],['live metadata in offline',c=>{c.cloud={};}]
])test('configuration refuses '+label+' before workflow',()=>{const c=normal();mutate(c);assert.throws(()=>validateEvidenceConfiguration(c));});
test('original normal arithmetic is 7 and14 with ratio2, while original wrong aggregates and raw observations remain unchanged',()=>{
 const b=records()['cloud-benchmark.json'],original=structuredClone(b),d=deriveEvidenceBenchmark(b,'a'.repeat(64));
 assert.deepEqual(d.summaries,[{replicas:1,rounds:2,medianJobsPerSecond:7,minJobsPerSecond:5,maxJobsPerSecond:9},{replicas:3,rounds:2,medianJobsPerSecond:14,minJobsPerSecond:12,maxJobsPerSecond:16}]);
 assert.equal(d.throughputRatio,2);assert.equal(d.completeSuccessfulCohort,true);assert.equal(d.scalingBenefitProven,false);assert.deepEqual(b,original);
});
for(const value of [null,'12',-1,Infinity,NaN])test('invalid stage rate '+String(value)+' is not filtered from median denominator',()=>{
 const b=records()['cloud-benchmark.json'];b.stages[1].jobsPerSecond=value;const d=deriveEvidenceBenchmark(b,'b'.repeat(64));
 assert.equal(d.numericComplete,false);assert.equal(d.observations.length,4);assert.equal(d.summaries[0].medianJobsPerSecond,null);assert.equal(d.throughputRatio,null);
});
test('partial/error/reordered/zero-denominator cohorts cannot become successful benefit evidence',()=>{
 for(const mutate of [b=>b.stages.pop(),b=>b.stages.reverse(),b=>{b.stages[0].errors=['original'];b.stages[0].completed=19;},b=>{b.stages[0].jobsPerSecond=0;b.stages[3].jobsPerSecond=0;}]){
  const b=records()['cloud-benchmark.json'];mutate(b);const d=deriveEvidenceBenchmark(b,'c'.repeat(64));assert.equal(d.scalingBenefitProven,false);
  if(b.stages.length!==4||b.stages[0].round!==1||b.stages[0].completed===19)assert.equal(d.completeSuccessfulCohort,false);
  if(b.stages[0].jobsPerSecond===0)assert.equal(d.throughputRatio,null);
 }
});
test('source hash and present provenance must match, without altering historical failed record',()=>{
 const c=normal(),name='cloud-autoscale-first-capacity-failed.json',bytes=Buffer.from(JSON.stringify(records()[name],null,2)+'\n'),original=Buffer.from(bytes),d=c.sources[name];
 assert.equal(validateEvidenceSource(bytes,d).passed,false);assert.deepEqual(bytes,original);
 for(const patch of [{sha256:'0'.repeat(64)},{observedAt:'2026-10-12T00:00:00Z'},{sourceCommit:'2'.repeat(40)}])assert.throws(()=>validateEvidenceSource(bytes,{...d,...patch}));
});
for(const content of ['{"a":1,"a":2}','{"access_token":"INSECURE_SYNTHETIC_SECRET"}','{"message":"Bearer INSECURE_SYNTHETIC_SECRET"}'])test('ambiguous or credential-bearing record is not copied',()=>{
 const bytes=Buffer.from(content),descriptor={sha256:sha256(bytes),observedAt:null,sourceCommit:null,experimentId:'synthetic'};assert.throws(()=>validateEvidenceSource(bytes,descriptor));
});
test('kubeconfig binds selected context, HTTPS CA and only the selected existing noninteractive plugin',()=>{
 const c=fixtureConfig(base,{mode:'collect-readonly'}).cloud,k=kubeconfig(c);assert.equal(validateEvidenceKubeconfig(k,c).server,'https://192.0.2.10');
 for(const change of [k=>{k['current-context']='other';},k=>{k.users[0].user.exec.command='/bin/sh';},k=>{k.users[0].user.exec.args=['-c','danger'];},k=>{k.clusters[0].cluster['insecure-skip-tls-verify']=true;},k=>{k.users[0].user.token='INSECURE';}]){const x=structuredClone(k);change(x);assert.throws(()=>validateEvidenceKubeconfig(x,c));}
});
test('read-only command builder never exposes a free-form scale/exec/login/deploy operation or foreign group',()=>{
 const c=fixtureConfig(base,{mode:'collect-readonly'}).cloud,f=cloudFixtures(c);
 assert.deepEqual(evidenceCommand(c,'nodes').args,['--kubeconfig='+c.kubeconfigFile,'--context='+c.context,'--request-timeout=20s','get','nodes','-o','json']);
 assert.equal(evidenceCommand(c,'mig',f.ref).args.includes('--project=synthetic-rg'),true);
 assert.throws(()=>evidenceCommand(c,'scale'));assert.throws(()=>evidenceCommand(c,'mig',f.ref.replace('synthetic-rg','foreign-rg')));
});
async function power(mutate=()=>{}){
 const c=fixtureConfig(base,{mode:'collect-readonly'}).cloud,f=cloudFixtures(c),k=validateEvidenceKubeconfig(kubeconfig(c),c);mutate(f);let time=0;
 const call=async key=>structuredClone(f[key]);return collectEvidencePower(c,k,call,()=>++time);
}
test('empty cluster members/nodes plus stable unchanged zero-target MIG can establish only a selected-cluster sampled stop',async()=>{
 const r=await power();assert.equal(r.computeStopped,true);assert.equal(r.instances[0].status,'RUNNING');assert.match(r.computeScope,/Selected cluster only/);assert.match(r.warning,/Billing data can lag/);assert.equal(r.shutdownActionExecuted,false);
});
test('old empty prefix error is fixed: a present Kubernetes node makes computeStopped false',async()=>{
 const r=await power(f=>{f.cluster.currentNodeCount=1;f.nodes.items=[{spec:{providerID:'gce://synthetic-rg/asia-southeast1-a/test-node'}}];});assert.equal(r.computeStopped,false);
});
for(const [label,mutate,want]of [
 ['positive target',f=>{f.mig.targetSize=1;},false],['member',f=>{f.members=[{instance:'https://www.googleapis.com/compute/v1/projects/synthetic-rg/zones/asia-southeast1-a/instances/test-node'}];},false],
 ['unstable MIG',f=>{f.mig.status.isStable=false;},null],['contradictory legacy node count',f=>{f.cluster.currentNodeCount=1;},null]
])test(label+' is not a zero-state success',async()=>assert.equal((await power(mutate)).computeStopped,want));
for(const [label,mutate]of [
 ['wrong project',f=>{f.cluster.selfLink=f.cluster.selfLink.replace('synthetic-rg','foreign-rg');}],['wrong cluster UID',f=>{f.cluster.id='foreign';}],['wrong namespace UID',f=>{f.namespace.metadata.uid='foreign';}],
 ['wrong CA',f=>{f.cluster.masterAuth.clusterCaCertificate=Buffer.from('wrong').toString('base64');}],['unknown MIG stability',f=>{delete f.mig.status.isStable;}],['wrong PVC namespace',f=>{f.pvcs.items[0].metadata.namespace='foreign';}]
])test(label+' remains unverified, not zero',async()=>assert.rejects(power(mutate)));
test('MIG changing during collection remains unknown instead of stitching before and after into zero',async()=>{
 const c=fixtureConfig(base,{mode:'collect-readonly'}).cloud,f=cloudFixtures(c),k=validateEvidenceKubeconfig(kubeconfig(c),c);let n=0;
 const r=await collectEvidencePower(c,k,async key=>{const x=structuredClone(f[key]);if(key==='mig'&&++n===2)x.currentActions.deleting=1;return x;},()=>1);
 assert.equal(r.computeStopped,null);assert.equal(r.managedGroups[0].unchanged,false);
});
test('failed source reservation never overwrites or pretends a run is owned',async()=>{
 const c=normal();const r=await runEvidenceProtocol(c,{reserve:async()=>{throw Error('existing');},get owned(){return false;}});
 assert.equal(r.status,'refused_before_reservation');assert.equal(r.retryAllowed,false);
});
for(const [label,mutate]of [
 ['nonzero current action despite stable flag',f=>{f.mig.currentActions.deleting=1;}],
 ['missing current actions',f=>{delete f.mig.currentActions;}],
 ['node pool reconciliation',f=>{f.cluster.nodePools[0].status='RECONCILING';}]
])test(label+' stays unknown',async()=>assert.equal((await power(mutate)).computeStopped,null));
for(const [label,mutate]of [
 ['foreign project instance',f=>{f.instances[0].selfLink=f.instances[0].selfLink.replace('synthetic-rg','foreign-rg');}],
 ['wrong Kubernetes list kind',f=>{f.nodes.kind='PodList';}],
 ['missing list version',f=>{delete f.pvcs.metadata.resourceVersion;}],
 ['forged cluster selfLink host',f=>{f.cluster.selfLink=f.cluster.selfLink.replace('container.googleapis.com','example.invalid');}]
])test(label+' cannot produce a stop assertion',async()=>assert.rejects(power(mutate)));
for(const fault of ['late-abort','expired','truncated','invalid-utf8','intent-sync'])test('protocol '+fault+' keeps available observation and starts no further command',async()=>{
 const c=fixtureConfig(base,{mode:'collect-readonly',powerOnly:true}),f=cloudFixtures(c.cloud),events=new Map(),controller=new AbortController();let owned=false,commands=0,expired=false;
 const io={powerOnly:true,kube:validateEvidenceKubeconfig(kubeconfig(c.cloud),c.cloud),signal:controller.signal,get owned(){return owned;},remaining:()=>expired?0:1000,clock:()=>1,
  reserve:async()=>{owned=true;},json:async(name,v)=>{if(fault==='intent-sync'&&name.endsWith('-intent.json'))throw Error('storage');events.set(name,v);},
  command:async()=>{commands++;if(fault==='late-abort')controller.abort();if(fault==='expired')expired=true;
   return {status:0,signal:null,stdout:fault==='invalid-utf8'?'{"text":"\ufffd"}':JSON.stringify(f.cluster),stderr:'',outputTruncated:fault==='truncated'};}};
 const r=await runEvidenceProtocol(c,io);assert.equal(r.status,'failed_or_unknown_retained');assert.equal(commands,fault==='intent-sync'?0:1);
 if(fault!=='intent-sync'){assert.equal(events.has('operations/0001-observed.json'),true);assert.equal(events.has('operations/0001-result.json'),false);}
 assert.equal(events.get('terminal.json').retryAllowed,false);
});
