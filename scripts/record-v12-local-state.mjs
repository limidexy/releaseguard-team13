import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const project='rg-v23-v6-20261015';
const ids=execFileSync('docker',['ps','-aq','--filter','label=com.docker.compose.project='+project],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);
assert.equal(ids.length,8);
const containers=JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({name:c.Name,service:c.Config.Labels['com.docker.compose.service'],status:c.State.Status,exitCode:c.State.ExitCode}));
assert.ok(containers.every(c=>c.status==='exited'&&c.exitCode===0));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,'20d258d891935b2d5bee3375ebf81b2872adf76f');
execFileSync('git',['diff','--check']);
const archives=[
['../ReleaseGuard_v28_v11_Results_20261016.zip','61173e30efaf244ecebf5b96eea8f7dacefb9b5788ac8603572992a6c0e44722'],
['../ReleaseGuard_v26_v8_Results_20261016.zip','6c3a05b907175815c2e5839c5800b503fee63a4605e34e0b6af461333aaad5b0'],
['../ReleaseGuard_v26_v9_Results_20261016.zip','dff9e78529a851e076981ce1e66873301829bc0fa9aeeab60b81551cd6d492e5'],
['../ReleaseGuard_v27_v10_Results_20261016.zip','13f5998fe558c1ad03fd5f667bf9f9f54a9e865a7fd7cb0c34b1d99ce78406b1'],
];
for(const [path,hash] of archives)assert.equal(sha(await readFile(path)),hash);
const report={checkedAt:new Date().toISOString(),head,commitCreated:false,pushed:false,cloudTouched:false,containers,volumesDeleted:false,oldArchivesUnchanged:archives.map(([path,sha256])=>({path,sha256})),scope:'Local isolated stack only; no assertion of cloud or hosted CI verification'};
await writeFile('docs/evidence/model-v12-2026-10-16/local-cleanup.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({stopped:containers.length,head,oldArchivesVerified:archives.length}));
