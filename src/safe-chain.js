import { getAddress } from 'viem';

export const ERC1271_MAGIC_VALUE = '0x1626ba7e';

export const SAFE_ABI = [
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }]
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'bytes' }],
    outputs: [{ type: 'bytes4' }]
  }
];

export async function fetchSafeOnchainConfig(publicClient, safeAddress) {
  const safe = getAddress(safeAddress);
  const [owners, threshold] = await Promise.all([
    publicClient.readContract({ address: safe, abi: SAFE_ABI, functionName: 'getOwners' }),
    publicClient.readContract({ address: safe, abi: SAFE_ABI, functionName: 'getThreshold' })
  ]);
  return {
    owners: owners.map((owner) => getAddress(owner)),
    threshold: Number(threshold)
  };
}

export async function isValidERC1271Signature(publicClient, safeAddress, messageHash, encodedSignatures) {
  const result = await publicClient.readContract({
    address: getAddress(safeAddress),
    abi: SAFE_ABI,
    functionName: 'isValidSignature',
    args: [messageHash, encodedSignatures]
  });
  return result.toLowerCase() === ERC1271_MAGIC_VALUE;
}

export function isSafeOwner(onchainConfig, signer) {
  const normalized = getAddress(signer).toLowerCase();
  return onchainConfig.owners.some((owner) => owner.toLowerCase() === normalized);
}
