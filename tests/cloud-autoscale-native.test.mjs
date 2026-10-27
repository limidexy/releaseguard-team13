import test from 'node:test';
import assert from 'node:assert/strict';
import {autoscaleCommand} from '../scripts/cloud-autoscale-native.mjs';
import {autoscaleBoundary} from './fixtures/cloud-autoscale-protocol.mjs';
test('metricrequest binds explicitselected context,namespace,controllerselector andmetricname',()=>{
 const {c}=autoscaleBoundary(),p=autoscaleCommand(c,'metric');assert.equal(p.command,c.cloud.kubectlExecutable);assert.ok(p.args.includes('--context='+c.cloud.context));assert.ok(p.args.includes('--kubeconfig='+c.cloud.kubeconfigFile));
 assert.equal(p.args.at(-1),'/apis/external.metrics.k8s.io/v1beta1/namespaces/releaseguard/s0-rabbitmq-releaseguard-evaluate?labelSelector=scaledobject.keda.sh%2Fname%3Devaluation-worker');
 assert.equal(p.args.includes('releaseguard'),true);assert.equal(p.args.includes('--raw'),true);
});
test('native surface excludes arbitrarycommand,manualscale,deployment,delete,logsandsecretreads',()=>{
 const {c}=autoscaleBoundary();for(const kind of ['scale','apply','delete','exec','logs','secrets','model','patch-hpa','current-context'])assert.throws(()=>autoscaleCommand(c,kind));
 assert.throws(()=>autoscaleCommand(c,'metric','/private/kube-patch-000001.json'));assert.throws(()=>autoscaleCommand(c,'patch-controller','/tmp/unselected.json'));
});
