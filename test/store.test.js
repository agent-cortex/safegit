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
