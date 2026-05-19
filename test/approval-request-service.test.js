import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommitApprovalRequest } from '../src/approval-request-service.js';

test('createCommitApprovalRequest persists repo config and approval payload from git metadata', async () => {
  const calls = [];
  const store = {
    async migrate() {
      calls.push(['migrate']);
    },
    async upsertRepo(input) {
      calls.push(['upsertRepo', input]);
    },
    async createApprovalRequest(input) {
      calls.push(['createApprovalRequest', input]);
    }
  };
  const result = await createCommitApprovalRequest({
    store,
    config: {
      safe: {
        address: '0x0000000000000000000000000000000000000001',
        chainId: 11155111,
        threshold: 2
      }
    },
    metadata: {
      host: 'github.com',
      owner: 'megabyte0x',
      name: 'demo',
      branch: 'main',
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      parentShas: [],
      author: 'Megabyte <m@example.com>',
      committer: 'Megabyte <m@example.com>'
    },
    approvalId: 'appr_service',
    createdAt: new Date('2026-05-17T08:00:00.000Z'),
    expiresAt: '2026-05-17T10:00:00.000Z'
  });

  assert.deepEqual(calls[0], ['migrate']);
  assert.deepEqual(calls[1], ['upsertRepo', {
    host: 'github.com',
    owner: 'megabyte0x',
    name: 'demo',
    safeAddress: '0x0000000000000000000000000000000000000001',
    chainId: 11155111,
    threshold: 2
  }]);
  assert.equal(calls[2][1].repoSlug, 'github.com/megabyte0x/demo');
  assert.equal(calls[2][1].approvalId, 'appr_service');
  assert.equal(calls[2][1].createdAt, '2026-05-17T08:00:00.000Z');
  assert.equal(calls[2][1].expiresAt, '2026-05-17T10:00:00.000Z');

  assert.equal(result.approvalId, 'appr_service');
  assert.equal(result.repoSlug, 'github.com/megabyte0x/demo');
  assert.equal(result.commitSha, '0x' + 'a'.repeat(40));
  assert.equal(result.payload.message.createdAt, '2026-05-17T08:00:00.000Z');
  assert.equal(result.payload.message.expiresAt, '2026-05-17T10:00:00.000Z');
});
