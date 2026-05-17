import express from 'express';
import cors from 'cors';
import { getAddress } from 'viem';
import { verifyApprovalSignature } from './attestation.js';
import { fetchSafeOnchainConfig, isSafeOwner } from './safe-chain.js';
import { renderApprovalPage } from './approval-page.js';

export function createApp({ store, provider = null } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/approve/:approvalId', async (req, res, next) => {
    try {
      const approval = await store.getApproval(req.params.approvalId);
      if (!approval) return res.status(404).send('Approval not found');
      res.type('html').send(renderApprovalPage(req.params.approvalId));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/approvals/:approvalId', async (req, res, next) => {
    try {
      const approval = await store.getApproval(req.params.approvalId);
      if (!approval) return res.status(404).json({ error: 'approval_not_found' });
      res.json(approval);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/approvals/:approvalId/signatures', async (req, res, next) => {
    try {
      const approval = await store.getApproval(req.params.approvalId);
      if (!approval) return res.status(404).json({ error: 'approval_not_found' });
      if (approval.status === 'expired' || approval.status === 'rejected') {
        return res.status(409).json({ error: `approval_${approval.status}` });
      }
      if (new Date(approval.expiresAt).getTime() < Date.now()) {
        return res.status(410).json({ error: 'approval_expired' });
      }

      const signer = getAddress(req.body?.signer || '');
      const signature = req.body?.signature;
      if (!signature || typeof signature !== 'string' || !signature.startsWith('0x')) {
        return res.status(400).json({ error: 'invalid_signature_format' });
      }

      const verification = await verifyApprovalSignature({ payload: approval.payload, signer, signature });
      if (!verification.valid) {
        return res.status(400).json({ error: 'invalid_signature', reason: verification.reason });
      }

      const repo = await store.getRepo(approval.repoSlug);
      if (!repo) return res.status(500).json({ error: 'repo_config_missing' });

      let threshold = repo.threshold;
      if (provider) {
        const onchain = await fetchSafeOnchainConfig(provider, repo.safeAddress);
        if (!isSafeOwner(onchain, verification.recovered)) {
          return res.status(403).json({ error: 'signer_not_safe_owner', signer: verification.recovered });
        }
        threshold = onchain.threshold;
      }

      await store.addSignature({ approvalId: approval.approvalId, signer: verification.recovered, signature });
      const updated = await store.markApprovedIfThresholdMet(approval.approvalId, threshold);
      res.json({ approvalId: updated.approvalId, status: updated.status, threshold, signatures: updated.signatures });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: 'internal_error', message: error.message || String(error) });
  });

  return app;
}
