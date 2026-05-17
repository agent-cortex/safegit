import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFunctionData, getAddress } from 'viem';
import { fetchSafeOnchainConfig, ERC1271_MAGIC_VALUE, isValidERC1271Signature, SAFE_ABI } from '../src/safe-chain.js';

test('fetchSafeOnchainConfig reads owners and threshold through publicClient.readContract', async () => {
  const ownerA = '0x0000000000000000000000000000000000000002';
  const ownerB = '0x0000000000000000000000000000000000000003';
  const publicClient = {
    async readContract({ functionName }) {
      if (functionName === 'getOwners') return [ownerA, ownerB];
      if (functionName === 'getThreshold') return 2n;
      throw new Error('unexpected call');
    }
  };

  const config = await fetchSafeOnchainConfig(publicClient, '0x0000000000000000000000000000000000000001');

  assert.deepEqual(config.owners, [getAddress(ownerA), getAddress(ownerB)]);
  assert.equal(config.threshold, 2);
});

test('isValidERC1271Signature checks magic value', async () => {
  const publicClient = {
    async readContract({ functionName, args }) {
      assert.equal(functionName, 'isValidSignature');
      assert.deepEqual(args, ['0x' + 'a'.repeat(64), '0x1234']);
      return '0x1626ba7e';
    }
  };

  assert.equal(await isValidERC1271Signature(publicClient, '0x0000000000000000000000000000000000000001', '0x' + 'a'.repeat(64), '0x1234'), true);
  assert.equal(ERC1271_MAGIC_VALUE, '0x1626ba7e');
});

test('SAFE_ABI remains viem-encodable for ERC-1271 calls', () => {
  const data = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'isValidSignature',
    args: ['0x' + 'a'.repeat(64), '0x1234']
  });
  assert.equal(data.slice(0, 10), ERC1271_MAGIC_VALUE);
});
