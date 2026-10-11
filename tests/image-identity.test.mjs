import test from 'node:test';
import assert from 'node:assert/strict';
import { configDigest } from '../scripts/image-identity.mjs';
test('image identity is config digest, not index or manifest digest', () => {
  const config = 'sha256:' + 'a'.repeat(64);
  assert.equal(configDigest({config:{digest:config},digest:'sha256:'+'b'.repeat(64)}),config);
  assert.throws(()=>configDigest({manifests:[{digest:config}]}));
  assert.throws(()=>configDigest({config:{digest:'latest'}}));
});
