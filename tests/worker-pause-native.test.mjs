import test from 'node:test';
import assert from 'node:assert/strict';
import {workerPauseCommand} from '../scripts/worker-pause-native.mjs';
import {workerPauseProgram} from '../scripts/worker-pause-program.mjs';
import {workerPauseBoundary} from './fixtures/worker-pause-protocol.mjs';
test('closedexecplan fixes Workercontainer,program,selectedPodUID,runandmainhash; neveracceptsarbitrarycode',()=>{
 const b=workerPauseBoundary(),pod={name:'synthetic-worker-pod',uid:b.vm.state.podUID},packet={...b.vm.ready(),runId:b.c.runId,podUID:pod.uid},p=workerPauseCommand(b.c,'fault-start',undefined,{pod,packet});
 assert.equal(p.command,b.c.cloud.kubectlExecutable);assert.deepEqual(p.args.slice(-8,-3),[pod.name,'-c','worker','--','/usr/local/bin/node']);assert.equal(p.args.at(-2),workerPauseProgram);assert.deepEqual(JSON.parse(p.args.at(-1)),packet);
 assert.ok(p.args.includes('--context='+b.c.cloud.context));assert.ok(p.args.includes('--kubeconfig='+b.c.cloud.kubeconfigFile));
 for(const change of [x=>{x.packet.podUID='foreign';},x=>{x.packet.runId='other';},x=>{x.packet.mainSHA256='b'.repeat(64);},x=>{x.packet.mode='agent';},x=>{x.pod.name='bad;command';}]){const x=structuredClone({pod,packet});change(x);assert.throws(()=>workerPauseCommand(b.c,'fault-start',undefined,x));}
});
test('operatornative surface excludesrawsignal,scale,workerpatch,apply,delete,secretsandunselectedexec',()=>{
 const b=workerPauseBoundary();for(const name of ['exec','SIGSTOP','SIGCONT','scale','patch-worker','apply','delete','secrets','logs'])assert.throws(()=>workerPauseCommand(b.c,name));
 assert.throws(()=>workerPauseCommand(b.c,'fault-start',undefined,{pod:{name:'x',uid:'x'},packet:{}}));
});
