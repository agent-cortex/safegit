export function createMemoryStore() {
  const repos = new Map();
  const approvals = new Map();
  const signatures = new Map();

  return {
    async upsertRepo({ host, owner, name, safeAddress, chainId, threshold }) {
      const slug = `${host}/${owner}/${name}`;
      const repo = { slug, host, owner, name, safeAddress, chainId: Number(chainId), threshold: Number(threshold) };
      repos.set(slug, repo);
      return repo;
    },

    async getRepo(slug) {
      return repos.get(slug) || null;
    },

    async createApprovalRequest({ repoSlug, approvalId, commitSha, branch, payload, messageHash, expiresAt }) {
      const request = {
        repoSlug,
        approvalId,
        commitSha,
        branch,
        payload,
        messageHash,
        expiresAt,
        status: 'pending',
        createdAt: new Date().toISOString(),
        signatures: []
      };
      approvals.set(approvalId, request);
      signatures.set(approvalId, []);
      return request;
    },

    async getApproval(approvalId) {
      const request = approvals.get(approvalId);
      if (!request) return null;
      return { ...request, signatures: signatures.get(approvalId) || [] };
    },

    async getApprovalByCommit(repoSlug, commitSha) {
      for (const request of approvals.values()) {
        if (request.repoSlug === repoSlug && request.commitSha === commitSha) {
          return { ...request, signatures: signatures.get(request.approvalId) || [] };
        }
      }
      return null;
    },

    async addSignature({ approvalId, signer, signature }) {
      if (!approvals.has(approvalId)) throw new Error(`Unknown approval: ${approvalId}`);
      const list = signatures.get(approvalId) || [];
      const next = list.filter((item) => item.signer.toLowerCase() !== signer.toLowerCase());
      next.push({ signer, signature, createdAt: new Date().toISOString() });
      signatures.set(approvalId, next);
      return next.at(-1);
    },

    async markApprovedIfThresholdMet(approvalId, threshold) {
      const request = approvals.get(approvalId);
      if (!request) throw new Error(`Unknown approval: ${approvalId}`);
      const list = signatures.get(approvalId) || [];
      if (list.length >= Number(threshold)) request.status = 'approved';
      approvals.set(approvalId, request);
      return { ...request, signatures: list };
    }
  };
}
