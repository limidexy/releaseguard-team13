import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { comparisonBytes,comparisonFiles,strictComparisonJSON } from '../scripts/comparison-files.mjs';
const posix={skip:process.platform==='win32'?'Explicit POSIX private-file contract':false},id='f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a';
const fixture=t=>{const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'rg-comparison-files-'));t.after(()=>{assert.match(root,/\/rg-comparison-files-[^/]+$/);fs.rmSync(root,{recursive:true});});return root;};
test('strict JSON rejects escaped duplicate keys, invalid UTF8 and excessive nesting',()=>{
 assert.deepEqual(strictComparisonJSON(Buffer.from('{"safe":1}')),{safe:1});
 for(const text of ['{"x":1,"x":2}','{"x":1,"\\u0078":2}','[ {"x":1,"x":2} ]','['.repeat(65)+'0'+']'.repeat(65)])assert.throws(()=>strictComparisonJSON(Buffer.from(text)));
 assert.throws(()=>strictComparisonJSON(Buffer.from([0xff])));
});
test('private input size/mode/symlink guards do not alter original bytes',posix,async t=>{
 const root=fixture(t),file=join(root,'selected.json'),raw=Buffer.from('{"synthetic":true}');fs.writeFileSync(file,raw,{mode:0o600});
 assert.deepEqual(await comparisonBytes(file,{privateMode:true}),raw);await assert.rejects(comparisonBytes(file,{limit:2}));
 fs.chmodSync(file,0o644);await assert.rejects(comparisonBytes(file,{privateMode:true}));fs.chmodSync(file,0o600);
 fs.symlinkSync(file,join(root,'alias.json'));await assert.rejects(comparisonBytes(join(root,'alias.json'),{privateMode:true}));
 fs.chmodSync(root,0o755);await assert.rejects(comparisonBytes(file,{privateMode:true}));fs.chmodSync(root,0o700);assert.deepEqual(fs.readFileSync(file),raw);
});
test('exclusive run/record reservation cannot overwrite or resume, and records stay private',posix,async t=>{
 const root=fixture(t),store=comparisonFiles(root,id);await store.reserve({synthetic:true});await store.json('report.json',{original:true});
 await assert.rejects(store.json('report.json',{changed:true}));await assert.rejects(comparisonFiles(root,id).reserve({}));
 assert.deepEqual(JSON.parse(fs.readFileSync(join(store.directory,'report.json'))),{original:true});assert.equal(fs.statSync(join(store.directory,'report.json')).mode&0o777,0o600);
 assert.equal(fs.statSync(store.directory).mode&0o777,0o700);await assert.rejects(store.json('../outside.json',{}));assert.equal(fs.existsSync(join(root,'outside.json')),false);
});
test('retained tool namespace is independent and cannot escape a closed path or invalid run ID',posix,async t=>{
 const root=fixture(t),a=comparisonFiles(root,id),b=comparisonFiles(root,id,'cloud-retained-rescore');await a.reserve({tool:'comparison'});await b.reserve({tool:'retained'});
 assert.notEqual(a.directory,b.directory);await a.json('report.json',{original:true});await b.json('report.json',{derived:true});
 assert.deepEqual(JSON.parse(fs.readFileSync(join(a.directory,'report.json'))),{original:true});
 for(const [runId,namespace]of [['../outside','comparison'],[id,'../outside'],[id,'unknown']])assert.throws(()=>comparisonFiles(root,runId,namespace));
});
test('evidence archive shares no run or record with comparison or retained-rescore namespaces',posix,async t=>{
 const root=fixture(t),stores=['comparison','cloud-retained-rescore','cloud-evidence'].map(n=>comparisonFiles(root,id,n));
 for(let n=0;n<stores.length;n++){await stores[n].reserve({tool:n});await stores[n].json('report.json',{index:n});}
 assert.equal(new Set(stores.map(x=>x.directory)).size,3);
 for(let n=0;n<stores.length;n++)assert.deepEqual(JSON.parse(fs.readFileSync(join(stores[n].directory,'report.json'))),{index:n});
 await assert.rejects(comparisonFiles(root,id,'cloud-evidence').reserve({overwrite:true}));
});
test('paired benchmark keeps six-digit operation records in its own namespace without widening old callers',posix,async t=>{
 const root=fixture(t),a=comparisonFiles(root,id,'cloud-benchmark'),b=comparisonFiles(root,id);await a.reserve({tool:'paired'});await b.reserve({tool:'comparison'});
 await a.json('operations/000001-intent.json',{planned:true});await assert.rejects(b.json('operations/000001-intent.json',{}));await assert.rejects(a.json('operations/0001-intent.json',{}));
 assert.equal(fs.existsSync(join(a.directory,'operations/000001-intent.json')),true);assert.equal(fs.existsSync(join(b.directory,'operations/000001-intent.json')),false);
});
test('paired benchmark normal evidence limit cannot consume the separate bounded recovery receipt allowance',posix,async t=>{
 const root=fixture(t),s=comparisonFiles(root,id,'cloud-benchmark');await s.reserve({synthetic:true});const block=Buffer.alloc(8*1024*1024,32);
 for(let i=0;i<8;i++){try{await s.put('synthetic-padding-'+i+'.bin',block);}catch{assert.equal(i,7);}}
 await assert.rejects(s.json('normal-after-limit.json',{state:'failed'}));
 await s.json('cleanup-native-000001-intent.json',{state:'restore-intent'});await s.json('cleanup-native-000001-observed.json',{state:'original-response'});
 await assert.rejects(s.json('cleanup-native-000001-intent.json',{overwrite:true}));await s.json('terminal.json',{passed:false});
 assert.deepEqual(JSON.parse(fs.readFileSync(join(s.directory,'cleanup-native-000001-observed.json'))),{state:'original-response'});
});
