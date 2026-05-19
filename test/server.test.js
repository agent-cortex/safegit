import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createMemoryStore } from '../src/store-memory.js';
import { createApp } from '../src/server.js';
import { buildApprovalPayload, hashApprovalPayload } from '../src/payload.js';

function randomAccount() {
  return privateKeyToAccount(generatePrivateKey());
}

async function signApproval(account, payload) {
  return account.signTypedData({
    domain: payload.domain,
    types: payload.types,
    primaryType: payload.primaryType,
    message: payload.message
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function samplePayload(safeAddress) {
  return buildApprovalPayload({
    repoHost: 'github.com', repoOwner: 'megabyte0x', repoName: 'demo', branch: 'main',
    commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), parentShas: [],
    author: 'Megabyte <m@example.com>', committer: 'Megabyte <m@example.com>',
    safeAddress, chainId: 11155111, approvalId: 'appr_http',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString()
  });
}

test('HTTP API accepts valid signatures and exposes approved status', async () => {
  const accountA = randomAccount();
  const accountB = randomAccount();
  const safe = '0x0000000000000000000000000000000000000001';
  const payload = samplePayload(safe);
  const store = createMemoryStore();
  await store.upsertRepo({ host: 'github.com', owner: 'megabyte0x', name: 'demo', safeAddress: safe, chainId: 11155111, threshold: 2 });
  await store.createApprovalRequest({
    repoSlug: 'github.com/megabyte0x/demo', approvalId: 'appr_http', commitSha: payload.message.commitSha,
    branch: 'main', payload, messageHash: hashApprovalPayload(payload), expiresAt: payload.message.expiresAt
  });

  const server = await listen(createApp({ store }));
  try {
    for (const account of [accountA, accountB]) {
      const signature = await signApproval(account, payload);
      const res = await fetch(`${baseUrl(server)}/api/approvals/appr_http/signatures`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signer: account.address, signature })
      });
      assert.equal(res.status, 200);
    }

    const status = await fetch(`${baseUrl(server)}/api/approvals/appr_http`).then((r) => r.json());
    assert.equal(status.status, 'approved');
    assert.equal(status.signatures.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP API rejects invalid signatures', async () => {
  const account = randomAccount();
  const other = randomAccount();
  const safe = '0x0000000000000000000000000000000000000001';
  const payload = samplePayload(safe);
  const store = createMemoryStore();
  await store.upsertRepo({ host: 'github.com', owner: 'megabyte0x', name: 'demo', safeAddress: safe, chainId: 11155111, threshold: 1 });
  await store.createApprovalRequest({
    repoSlug: 'github.com/megabyte0x/demo', approvalId: 'appr_http', commitSha: payload.message.commitSha,
    branch: 'main', payload, messageHash: hashApprovalPayload(payload), expiresAt: payload.message.expiresAt
  });

  const server = await listen(createApp({ store }));
  try {
    const signature = await signApproval(account, payload);
    const res = await fetch(`${baseUrl(server)}/api/approvals/appr_http/signatures`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer: other.address, signature })
    });
    assert.equal(res.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP API rejects malformed signer addresses as bad requests', async () => {
  const account = randomAccount();
  const safe = '0x0000000000000000000000000000000000000001';
  const payload = samplePayload(safe);
  const store = createMemoryStore();
  await store.upsertRepo({ host: 'github.com', owner: 'megabyte0x', name: 'demo', safeAddress: safe, chainId: 11155111, threshold: 1 });
  await store.createApprovalRequest({
    repoSlug: 'github.com/megabyte0x/demo', approvalId: 'appr_http', commitSha: payload.message.commitSha,
    branch: 'main', payload, messageHash: hashApprovalPayload(payload), expiresAt: payload.message.expiresAt
  });

  const server = await listen(createApp({ store }));
  try {
    const signature = await signApproval(account, payload);
    const res = await fetch(`${baseUrl(server)}/api/approvals/appr_http/signatures`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer: 'not-an-address', signature })
    });
    const out = await res.json();

    assert.equal(res.status, 400);
    assert.equal(out.error, 'invalid_signer');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP API does not persist signatures rejected by live Safe owner validation', async () => {
  const owner = randomAccount();
  const nonOwner = randomAccount();
  const safe = '0x0000000000000000000000000000000000000001';
  const payload = samplePayload(safe);
  const store = createMemoryStore();
  await store.upsertRepo({ host: 'github.com', owner: 'megabyte0x', name: 'demo', safeAddress: safe, chainId: 11155111, threshold: 1 });
  await store.createApprovalRequest({
    repoSlug: 'github.com/megabyte0x/demo', approvalId: 'appr_http', commitSha: payload.message.commitSha,
    branch: 'main', payload, messageHash: hashApprovalPayload(payload), expiresAt: payload.message.expiresAt
  });
  const provider = {
    async readContract({ functionName }) {
      if (functionName === 'getOwners') return [owner.address];
      if (functionName === 'getThreshold') return 1n;
      throw new Error(`unexpected function ${functionName}`);
    }
  };

  const server = await listen(createApp({ store, provider }));
  try {
    const signature = await signApproval(nonOwner, payload);
    const res = await fetch(`${baseUrl(server)}/api/approvals/appr_http/signatures`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer: nonOwner.address, signature })
    });
    assert.equal(res.status, 403);

    const status = await fetch(`${baseUrl(server)}/api/approvals/appr_http`).then((r) => r.json());
    assert.equal(status.status, 'pending');
    assert.deepEqual(status.signatures, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP API rate limits noisy clients', async () => {
  const store = createMemoryStore();
  const server = await listen(createApp({ store, rateLimit: { windowMs: 60_000, max: 1 } }));
  try {
    const first = await fetch(`${baseUrl(server)}/api/approvals/missing`);
    assert.equal(first.status, 404);
    const second = await fetch(`${baseUrl(server)}/api/approvals/missing`);
    assert.equal(second.status, 429);
    const out = await second.json();
    assert.equal(out.error, 'rate_limited');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP API can require bearer token auth while approval page still renders', async () => {
  const safe = '0x0000000000000000000000000000000000000001';
  const payload = samplePayload(safe);
  const store = createMemoryStore();
  await store.upsertRepo({ host: 'github.com', owner: 'megabyte0x', name: 'demo', safeAddress: safe, chainId: 11155111, threshold: 1 });
  await store.createApprovalRequest({
    repoSlug: 'github.com/megabyte0x/demo', approvalId: 'appr_http', commitSha: payload.message.commitSha,
    branch: 'main', payload, messageHash: hashApprovalPayload(payload), expiresAt: payload.message.expiresAt
  });

  const server = await listen(createApp({ store, apiToken: 'secret-token' }));
  try {
    const page = await fetch(`${baseUrl(server)}/approve/appr_http`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /API access token/);

    const rejected = await fetch(`${baseUrl(server)}/api/approvals/appr_http`);
    assert.equal(rejected.status, 401);

    const accepted = await fetch(`${baseUrl(server)}/api/approvals/appr_http`, {
      headers: { authorization: 'Bearer secret-token' }
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).approvalId, 'appr_http');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
