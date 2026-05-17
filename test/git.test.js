import assert from 'node:assert/strict';
import test from 'node:test';
import { repoSlugFromRemote, normalizeHexSha } from '../src/git.js';

test('repoSlugFromRemote parses https GitHub remotes', () => {
  assert.deepEqual(repoSlugFromRemote('https://github.com/megabyte0x/demo.git'), {
    host: 'github.com', owner: 'megabyte0x', name: 'demo'
  });
});

test('repoSlugFromRemote parses ssh GitHub remotes', () => {
  assert.deepEqual(repoSlugFromRemote('git@github.com:megabyte0x/demo.git'), {
    host: 'github.com', owner: 'megabyte0x', name: 'demo'
  });
});

test('normalizeHexSha accepts 40-byte sha with or without 0x', () => {
  assert.equal(normalizeHexSha('a'.repeat(40)), '0x' + 'a'.repeat(40));
  assert.equal(normalizeHexSha('0x' + 'b'.repeat(40)), '0x' + 'b'.repeat(40));
});

test('normalizeHexSha rejects invalid sha', () => {
  assert.throws(() => normalizeHexSha('nope'), /40 hex chars/);
});
