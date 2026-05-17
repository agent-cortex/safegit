import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.resolve(__dirname, '../sql/001_init.sql');

export function createPgStore({ connectionString = process.env.SAFEGIT_DATABASE_URL || process.env.DATABASE_URL } = {}) {
  if (!connectionString) {
    throw new Error('Set SAFEGIT_DATABASE_URL or DATABASE_URL to your Postgres connection string');
  }
  const pool = new Pool({ connectionString });

  return {
    async close() {
      await pool.end();
    },

    async migrate() {
      await pool.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
      return true;
    },

    async upsertRepo({ host, owner, name, safeAddress, chainId, threshold }) {
      const slug = `${host}/${owner}/${name}`;
      const { rows } = await pool.query(
        `INSERT INTO safegit_repos (slug, host, owner_name, repo_name, safe_address, chain_id, threshold, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (slug) DO UPDATE SET
           safe_address = EXCLUDED.safe_address,
           chain_id = EXCLUDED.chain_id,
           threshold = EXCLUDED.threshold,
           updated_at = now()
         RETURNING slug, host, owner_name AS owner, repo_name AS name, safe_address AS "safeAddress", chain_id AS "chainId", threshold`,
        [slug, host, owner, name, safeAddress, Number(chainId), Number(threshold)]
      );
      return rows[0];
    },

    async getRepo(slug) {
      const { rows } = await pool.query(
        `SELECT slug, host, owner_name AS owner, repo_name AS name, safe_address AS "safeAddress", chain_id AS "chainId", threshold
         FROM safegit_repos WHERE slug = $1`,
        [slug]
      );
      return rows[0] || null;
    },

    async createApprovalRequest({ repoSlug, approvalId, commitSha, branch, payload, messageHash, expiresAt }) {
      const { rows } = await pool.query(
        `INSERT INTO safegit_approval_requests (repo_slug, approval_id, commit_sha, branch, payload, message_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (repo_slug, commit_sha) DO UPDATE SET
           payload = EXCLUDED.payload,
           message_hash = EXCLUDED.message_hash,
           branch = EXCLUDED.branch,
           expires_at = EXCLUDED.expires_at,
           status = 'pending',
           updated_at = now()
         RETURNING repo_slug AS "repoSlug", approval_id AS "approvalId", commit_sha AS "commitSha", branch, payload, message_hash AS "messageHash", status, expires_at AS "expiresAt", created_at AS "createdAt"`,
        [repoSlug, approvalId, commitSha, branch, JSON.stringify(payload), messageHash, expiresAt]
      );
      return { ...rows[0], signatures: [] };
    },

    async getApproval(approvalId) {
      const { rows } = await pool.query(
        `SELECT repo_slug AS "repoSlug", approval_id AS "approvalId", commit_sha AS "commitSha", branch, payload, message_hash AS "messageHash", status, expires_at AS "expiresAt", created_at AS "createdAt"
         FROM safegit_approval_requests WHERE approval_id = $1`,
        [approvalId]
      );
      if (!rows[0]) return null;
      return { ...rows[0], signatures: await this.listSignatures(approvalId) };
    },

    async getApprovalByCommit(repoSlug, commitSha) {
      const { rows } = await pool.query(
        `SELECT repo_slug AS "repoSlug", approval_id AS "approvalId", commit_sha AS "commitSha", branch, payload, message_hash AS "messageHash", status, expires_at AS "expiresAt", created_at AS "createdAt"
         FROM safegit_approval_requests WHERE repo_slug = $1 AND commit_sha = $2`,
        [repoSlug, commitSha]
      );
      if (!rows[0]) return null;
      return { ...rows[0], signatures: await this.listSignatures(rows[0].approvalId) };
    },

    async listSignatures(approvalId) {
      const { rows } = await pool.query(
        `SELECT signer, signature, created_at AS "createdAt"
         FROM safegit_signatures WHERE approval_id = $1 ORDER BY signer ASC`,
        [approvalId]
      );
      return rows;
    },

    async addSignature({ approvalId, signer, signature }) {
      const { rows } = await pool.query(
        `INSERT INTO safegit_signatures (approval_id, signer, signature)
         VALUES ($1,$2,$3)
         ON CONFLICT (approval_id, signer) DO UPDATE SET signature = EXCLUDED.signature, created_at = now()
         RETURNING signer, signature, created_at AS "createdAt"`,
        [approvalId, signer, signature]
      );
      return rows[0];
    },

    async markApprovedIfThresholdMet(approvalId, threshold) {
      const signatures = await this.listSignatures(approvalId);
      if (signatures.length >= Number(threshold)) {
        await pool.query(`UPDATE safegit_approval_requests SET status = 'approved', updated_at = now() WHERE approval_id = $1`, [approvalId]);
      }
      return this.getApproval(approvalId);
    }
  };
}
