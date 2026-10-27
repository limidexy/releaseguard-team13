import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkCommand,confirmBenchmarkCloud} from '../scripts/cloud-benchmark-native.mjs';
import {sha256} from '../scripts/comparison-files.mjs';
import {protocolBoundary} from './fixtures/cloud-benchmark-protocol.mjs';
import {cloudFixtures,kubeconfig} from './fixtures/gcp-evidence-data.mjs';
const setup=()=>{
 const {c}=protocolBoundary(),f=cloudFixtures(c.cloud);f.cluster.nodePools[0].config.machineType='e2-standard-2';
 f.nodes.items=c.target.nodeNames.map(name=>({metadata:{name},spec:{providerID:'gce://'+c.cloud.project+'/'+c.cloud.zone+'/'+name},status:{conditions:[{type:'Ready',status:'True'}]}}));
 const k=kubeconfig(c.cloud).clusters[0].cluster;return {c,f,kube:{server:k.server,caSHA256:sha256(Buffer.from(k['certificate-authority-data'],'base64'))}};
};
test('read-only proof binds clusterID, CA/server, namespaceUID, original two e2-standard-2 nodes and readiness',()=>{
 const {c,f,kube}=setup(),r=confirmBenchmarkCloud(c,kube,f);assert.equal(r.twoNodeObservationOnly,true);assert.deepEqual(r.nodeNames,c.target.nodeNames);assert.equal(r.notCapacityOrCostAttestation,true);
});
for(const [name,mutate]of [
 ['foreign cluster',f=>{f.cluster.id='foreign';}],['foreign namespace',f=>{f.namespace.metadata.uid='foreign';}],['one node',f=>{f.nodes.items.pop();}],
 ['foreign project node',f=>{f.nodes.items[0].spec.providerID='gce://foreign/zone/a';}],['unschedulable',f=>{f.nodes.items[0].spec.unschedulable=true;}],
 ['not Ready',f=>{f.nodes.items[0].status.conditions=[];}],['different machine',f=>{f.cluster.nodePools[0].config.machineType='e2-standard-8';}],
 ['node autoscaler enabled',f=>{f.cluster.nodePools[0].autoscaling.enabled=true;}],['partial list',f=>{f.nodes.metadata.continue='next';}],['extra pool',f=>{f.cluster.nodePools.push(structuredClone(f.cluster.nodePools[0]));}],
])test(name+' cannot authorize a comparison',()=>{const {c,f,kube}=setup();mutate(f);assert.throws(()=>confirmBenchmarkCloud(c,kube,f));});
test('native command plan selects explicit kubeconfig/context/namespace and only named Worker/controller patches',()=>{
 const {c}=setup();for(const kind of ['worker','controller','hpas','pods','replicaSets']){const p=benchmarkCommand(c,kind);assert.equal(p.command,c.cloud.kubectlExecutable);assert.equal(p.args[0],'--kubeconfig='+c.cloud.kubeconfigFile);assert.equal(p.args[1],'--context='+c.cloud.context);assert.equal(p.args.includes('get'),true);}
 const p=benchmarkCommand(c,'patch-worker','/private/owned/kube-patch-000001.json');assert.equal(p.args.includes('--type=json'),true);assert.equal(p.args.includes('--patch-file=/private/owned/kube-patch-000001.json'),true);assert.equal(p.args.includes('apply'),false);
 for(const k of ['delete','resize','exec','get-credentials','patch-gateway'])assert.throws(()=>benchmarkCommand(c,k));
 assert.throws(()=>benchmarkCommand(c,'patch-worker','inline secret'));assert.throws(()=>benchmarkCommand(c,'worker','/private/owned/kube-patch-000001.json'));
});
