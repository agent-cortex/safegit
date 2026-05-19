import { normalizeHexSha } from './git.js';
import { buildApprovalPayload, hashApprovalPayload } from './payload.js';

export function repoSlugFromMetadata(metadata) {
  return `${metadata.host}/${metadata.owner}/${metadata.name}`;
}

function repoConfigFrom(metadata, config) {
  return {
    host: metadata.host,
    owner: metadata.owner,
    name: metadata.name,
    safeAddress: config.safe.address,
    chainId: config.safe.chainId,
    threshold: config.safe.threshold
  };
}

function isoTimestamp(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function createCommitApprovalRequest({ store, config, metadata, approvalId, createdAt, expiresAt }) {
  const createdAtIso = isoTimestamp(createdAt);
  const payload = buildApprovalPayload({
    repoHost: metadata.host,
    repoOwner: metadata.owner,
    repoName: metadata.name,
    branch: metadata.branch,
    commitSha: metadata.commitSha,
    treeSha: metadata.treeSha,
    parentShas: metadata.parentShas,
    author: metadata.author,
    committer: metadata.committer,
    safeAddress: config.safe.address,
    chainId: config.safe.chainId,
    approvalId,
    createdAt: createdAtIso,
    expiresAt
  });
  const messageHash = hashApprovalPayload(payload);
  const commitSha = normalizeHexSha(metadata.commitSha);
  const repoSlug = repoSlugFromMetadata(metadata);

  await store.migrate();
  await store.upsertRepo(repoConfigFrom(metadata, config));
  await store.createApprovalRequest({
    repoSlug,
    approvalId,
    commitSha,
    branch: metadata.branch,
    createdAt: createdAtIso,
    payload,
    messageHash,
    expiresAt
  });

  return {
    approvalId,
    repoSlug,
    commitSha,
    branch: metadata.branch,
    messageHash,
    payload
  };
}
