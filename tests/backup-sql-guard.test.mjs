import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('hosted SQL consumer refuses locally before any Docker or database boundary',()=>{
 const r=spawnSync(process.execPath,['scripts/verify-backup-sql.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});assert.equal(r.status,1);assert.match(r.stderr,/no Docker or database operation was entered/);assert.equal(r.stdout,'');
});
