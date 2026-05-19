import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryStore } from '../src/store-memory.js';

test('store creates repo config and approval request lifecycle', async () => {
  const store = createMemoryStore();
  const repo = await store.upsertRepo({
    host: 'github.com', owner: 'megabyte0x', name: 'demo',
    safeAddress: '0x0000000000000000000000000000000000000001', chainId: 11155111,
    threshold: 2
  });

  assert.equal(repo.slug, 'github.com/megabyte0x/demo');

  const request = await store.createApprovalRequest({
    repoSlug: repo.slug,
    approvalId: 'appr_1',
    commitSha: '0x' + 'a'.repeat(40),
    branch: 'main',
    payload: { hello: 'world' },
    messageHash: '0x' + 'b'.repeat(64),
    expiresAt: '2026-05-17T09:00:00.000Z'
  });

  assert.equal(request.status, 'pending');
  assert.equal((await store.getApprovalByCommit(repo.slug, '0x' + 'a'.repeat(40))).approvalId, 'appr_1');

  await store.addSignature({
    approvalId: 'appr_1',
    signer: '0x0000000000000000000000000000000000000002',
    signature: '0x1234'
  });
  await store.addSignature({
    approvalId: 'appr_1',
    signer: '0x0000000000000000000000000000000000000003',
    signature: '0x5678'
  });

  const approved = await store.markApprovedIfThresholdMet('appr_1', 2);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.signatures.length, 2);
});

test('store refreshes one approval per repo commit and clears stale signatures', async () => {
  const store = createMemoryStore();
  const repo = await store.upsertRepo({
    host: 'github.com', owner: 'megabyte0x', name: 'demo',
    safeAddress: '0x0000000000000000000000000000000000000001', chainId: 11155111,
    threshold: 1
  });
  const commitSha = '0x' + 'a'.repeat(40);

  await store.createApprovalRequest({
    repoSlug: repo.slug,
    approvalId: 'appr_original',
    commitSha,
    branch: 'main',
    createdAt: '2026-05-17T08:00:00.000Z',
    payload: { version: 1 },
    messageHash: '0x' + 'b'.repeat(64),
    expiresAt: '2026-05-17T09:00:00.000Z'
  });
  await store.addSignature({
    approvalId: 'appr_original',
    signer: '0x0000000000000000000000000000000000000002',
    signature: '0x1234'
  });
  await store.markApprovedIfThresholdMet('appr_original', 1);

  const refreshed = await store.createApprovalRequest({
    repoSlug: repo.slug,
    approvalId: 'appr_replacement',
    commitSha,
    branch: 'main',
    createdAt: '2026-05-17T09:00:00.000Z',
    payload: { version: 2 },
    messageHash: '0x' + 'c'.repeat(64),
    expiresAt: '2026-05-17T10:00:00.000Z'
  });

  assert.equal(refreshed.approvalId, 'appr_replacement');
  assert.equal(refreshed.status, 'pending');
  assert.deepEqual(refreshed.signatures, []);
  assert.equal(refreshed.createdAt, '2026-05-17T09:00:00.000Z');
  assert.equal(refreshed.messageHash, '0x' + 'c'.repeat(64));

  const byCommit = await store.getApprovalByCommit(repo.slug, commitSha);
  assert.equal(byCommit.approvalId, 'appr_replacement');
  assert.equal(byCommit.createdAt, '2026-05-17T09:00:00.000Z');
  assert.equal(byCommit.messageHash, '0x' + 'c'.repeat(64));
  assert.deepEqual(byCommit.signatures, []);
  assert.equal(await store.getApproval('appr_original'), null);
});
