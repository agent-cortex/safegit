import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryStore } from '../src/store-memory.js';
import { createApp } from '../src/server.js';
import { buildApprovalPayload, hashApprovalPayload } from '../src/payload.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function samplePayload() {
  return buildApprovalPayload({
    repoHost: 'github.com', repoOwner: 'megabyte0x', repoName: 'demo', branch: 'main',
    commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), parentShas: [],
    author: 'Megabyte <m@example.com>', committer: 'Megabyte <m@example.com>',
    safeAddress: '0x0000000000000000000000000000000000000001', chainId: 11155111,
    approvalId: 'appr_page', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString()
  });
}

test('GET /approve/:approvalId serves wallet signing UI', async () => {
  const payload = samplePayload();
  const store = createMemoryStore();
  await store.upsertRepo({ host: 'github.com', owner: 'megabyte0x', name: 'demo', safeAddress: payload.message.safe, chainId: 11155111, threshold: 1 });
  await store.createApprovalRequest({
    repoSlug: 'github.com/megabyte0x/demo', approvalId: 'appr_page', commitSha: payload.message.commitSha,
    branch: 'main', payload, messageHash: hashApprovalPayload(payload), expiresAt: payload.message.expiresAt
  });

  const server = await listen(createApp({ store }));
  try {
    const res = await fetch(`${baseUrl(server)}/approve/appr_page`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /SafeGit Approval/);
    assert.match(html, /appr_page/);
    assert.match(html, /eth_signTypedData_v4/);
    assert.match(html, /api\/approvals/);
    assert.match(html, /signatures/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/approvals/:approvalId returns payload needed by LocalSafe', async () => {
  const payload = samplePayload();
  const store = createMemoryStore();
  await store.upsertRepo({ host: 'github.com', owner: 'megabyte0x', name: 'demo', safeAddress: payload.message.safe, chainId: 11155111, threshold: 1 });
  await store.createApprovalRequest({
    repoSlug: 'github.com/megabyte0x/demo', approvalId: 'appr_page', commitSha: payload.message.commitSha,
    branch: 'main', payload, messageHash: hashApprovalPayload(payload), expiresAt: payload.message.expiresAt
  });

  const server = await listen(createApp({ store }));
  try {
    const json = await fetch(`${baseUrl(server)}/api/approvals/appr_page`).then((r) => r.json());
    assert.equal(json.approvalId, 'appr_page');
    assert.equal(json.payload.primaryType, 'GitCommitApproval');
    assert.equal(json.payload.message.repoName, 'demo');
    assert.equal(json.signatures.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
