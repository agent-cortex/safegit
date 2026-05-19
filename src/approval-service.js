import { getAddress } from 'viem';
import { verifyApprovalSignature } from './attestation.js';
import { fetchSafeOnchainConfig, isSafeOwner } from './safe-chain.js';

export class ApprovalRequestError extends Error {
  constructor(status, body) {
    super(body.reason || body.error);
    this.name = 'ApprovalRequestError';
    this.status = status;
    this.body = body;
  }
}

export function approvalErrorResponse(error) {
  if (error instanceof ApprovalRequestError) {
    return { status: error.status, body: error.body };
  }
  return null;
}

function rejectApproval(status, body) {
  throw new ApprovalRequestError(status, body);
}

function normalizeSigner(value) {
  try {
    return getAddress(value || '');
  } catch {
    return null;
  }
}

export async function submitApprovalSignature({ store, provider = null, approvalId, signer, signature, now = new Date() }) {
  const approval = await store.getApproval(approvalId);
  if (!approval) rejectApproval(404, { error: 'approval_not_found' });
  if (approval.status === 'expired' || approval.status === 'rejected') {
    rejectApproval(409, { error: `approval_${approval.status}` });
  }
  if (new Date(approval.expiresAt).getTime() < now.getTime()) {
    rejectApproval(410, { error: 'approval_expired' });
  }

  const normalizedSigner = normalizeSigner(signer);
  if (!normalizedSigner) rejectApproval(400, { error: 'invalid_signer' });
  if (!signature || typeof signature !== 'string' || !signature.startsWith('0x')) {
    rejectApproval(400, { error: 'invalid_signature_format' });
  }

  const verification = await verifyApprovalSignature({ payload: approval.payload, signer: normalizedSigner, signature });
  if (!verification.valid) {
    rejectApproval(400, { error: 'invalid_signature', reason: verification.reason });
  }

  const repo = await store.getRepo(approval.repoSlug);
  if (!repo) rejectApproval(500, { error: 'repo_config_missing' });

  let threshold = repo.threshold;
  if (provider) {
    const onchain = await fetchSafeOnchainConfig(provider, repo.safeAddress);
    if (!isSafeOwner(onchain, verification.recovered)) {
      rejectApproval(403, { error: 'signer_not_safe_owner', signer: verification.recovered });
    }
    threshold = onchain.threshold;
  }

  await store.addSignature({ approvalId: approval.approvalId, signer: verification.recovered, signature });
  const updated = await store.markApprovedIfThresholdMet(approval.approvalId, threshold);
  return {
    approvalId: updated.approvalId,
    status: updated.status,
    threshold,
    signatures: updated.signatures
  };
}
