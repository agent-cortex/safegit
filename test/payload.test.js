import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApprovalPayload, hashApprovalPayload } from '../src/payload.js';

test('buildApprovalPayload includes replay protection fields from git metadata', () => {
  const payload = buildApprovalPayload({
    repoHost: 'github.com',
    repoOwner: 'megabyte0x',
    repoName: 'demo',
    branch: 'main',
    commitSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    parentShas: ['c'.repeat(40)],
    author: 'Megabyte <m@example.com>',
    committer: 'Megabyte <m@example.com>',
    safeAddress: '0x0000000000000000000000000000000000000001',
    chainId: 11155111,
    approvalId: 'appr_123',
    createdAt: '2026-05-17T08:00:00.000Z',
    expiresAt: '2026-05-17T09:00:00.000Z'
  });

  assert.equal(payload.primaryType, 'GitCommitApproval');
  assert.equal(payload.domain.name, 'SafeGit');
  assert.equal(payload.domain.chainId, 11155111);
  assert.equal(payload.domain.verifyingContract, '0x0000000000000000000000000000000000000001');
  assert.equal(payload.message.repoHost, 'github.com');
  assert.equal(payload.message.repoOwner, 'megabyte0x');
  assert.equal(payload.message.repoName, 'demo');
  assert.equal(payload.message.branch, 'main');
  assert.equal(payload.message.commitSha, '0x' + 'a'.repeat(40));
  assert.equal(payload.message.treeSha, '0x' + 'b'.repeat(40));
  assert.deepEqual(payload.message.parentShas, ['0x' + 'c'.repeat(40)]);
  assert.equal(payload.message.approvalId, 'appr_123');
  assert.equal(payload.message.safe, '0x0000000000000000000000000000000000000001');
});

test('hashApprovalPayload is deterministic for equivalent payloads', () => {
  const input = {
    repoHost: 'github.com', repoOwner: 'o', repoName: 'r', branch: 'main',
    commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), parentShas: [],
    author: 'A <a@x.y>', committer: 'A <a@x.y>',
    safeAddress: '0x0000000000000000000000000000000000000001', chainId: 1,
    approvalId: 'same', createdAt: '2026-05-17T08:00:00.000Z', expiresAt: '2026-05-17T09:00:00.000Z'
  };
  assert.equal(hashApprovalPayload(buildApprovalPayload(input)), hashApprovalPayload(buildApprovalPayload({ ...input })));
});
