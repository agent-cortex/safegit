import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildApprovalPayload } from '../src/payload.js';
import { verifyApprovalSignature, verifyApprovalThreshold } from '../src/attestation.js';

function randomAccount() {
  return privateKeyToAccount(generatePrivateKey());
}

function samplePayload(safeAddress = '0x0000000000000000000000000000000000000001') {
  return buildApprovalPayload({
    repoHost: 'github.com', repoOwner: 'megabyte0x', repoName: 'demo', branch: 'main',
    commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), parentShas: [],
    author: 'Megabyte <m@example.com>', committer: 'Megabyte <m@example.com>',
    safeAddress, chainId: 11155111, approvalId: 'appr_sig',
    createdAt: '2026-05-17T08:00:00.000Z', expiresAt: '2026-05-17T09:00:00.000Z'
  });
}

async function signApproval(account, payload) {
  return account.signTypedData({
    domain: payload.domain,
    types: payload.types,
    primaryType: payload.primaryType,
    message: payload.message
  });
}

test('verifyApprovalSignature accepts EIP-712 signature from claimed signer', async () => {
  const account = randomAccount();
  const payload = samplePayload();
  const signature = await signApproval(account, payload);

  const result = await verifyApprovalSignature({ payload, signer: account.address, signature });

  assert.equal(result.valid, true);
  assert.equal(result.recovered.toLowerCase(), account.address.toLowerCase());
});

test('verifyApprovalSignature rejects signature when claimed signer differs', async () => {
  const account = randomAccount();
  const other = randomAccount();
  const payload = samplePayload();
  const signature = await signApproval(account, payload);

  const result = await verifyApprovalSignature({ payload, signer: other.address, signature });

  assert.equal(result.valid, false);
  assert.match(result.reason, /does not match/i);
});

test('verifyApprovalThreshold dedupes signers and requires enough valid signatures', async () => {
  const accountA = randomAccount();
  const accountB = randomAccount();
  const payload = samplePayload();
  const sigA = await signApproval(accountA, payload);
  const sigB = await signApproval(accountB, payload);

  const result = await verifyApprovalThreshold({
    payload,
    threshold: 2,
    signatures: [
      { signer: accountA.address, signature: sigA },
      { signer: accountA.address, signature: sigA },
      { signer: accountB.address, signature: sigB }
    ]
  });

  assert.equal(result.approved, true);
  assert.equal(result.validSigners.length, 2);
});
