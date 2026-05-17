import { getAddress, hashTypedData, keccak256, stringToBytes } from 'viem';
import { normalizeHexSha } from './git.js';

export const GIT_COMMIT_APPROVAL_TYPES = {
  GitCommitApproval: [
    { name: 'repoHost', type: 'string' },
    { name: 'repoOwner', type: 'string' },
    { name: 'repoName', type: 'string' },
    { name: 'branch', type: 'string' },
    { name: 'commitSha', type: 'bytes20' },
    { name: 'treeSha', type: 'bytes20' },
    { name: 'parentShas', type: 'bytes20[]' },
    { name: 'author', type: 'string' },
    { name: 'committer', type: 'string' },
    { name: 'safe', type: 'address' },
    { name: 'approvalId', type: 'string' },
    { name: 'createdAt', type: 'string' },
    { name: 'expiresAt', type: 'string' }
  ]
};

export function newApprovalId(commitSha, now = new Date()) {
  const digest = keccak256(stringToBytes(`${commitSha}:${now.toISOString()}:${Math.random()}`)).slice(2, 14);
  return `appr_${digest}`;
}

export function buildApprovalPayload(input) {
  const safe = getAddress(input.safeAddress);
  return {
    types: GIT_COMMIT_APPROVAL_TYPES,
    primaryType: 'GitCommitApproval',
    domain: {
      name: 'SafeGit',
      version: '1',
      chainId: Number(input.chainId),
      verifyingContract: safe
    },
    message: {
      repoHost: input.repoHost,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      branch: input.branch,
      commitSha: normalizeHexSha(input.commitSha),
      treeSha: normalizeHexSha(input.treeSha),
      parentShas: (input.parentShas || []).map(normalizeHexSha),
      author: input.author,
      committer: input.committer,
      safe,
      approvalId: input.approvalId,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt
    }
  };
}

export function hashApprovalPayload(payload) {
  return hashTypedData({ domain: payload.domain, types: payload.types, primaryType: payload.primaryType, message: payload.message });
}
