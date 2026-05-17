#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { getAddress } from 'viem';
import { repoSlugFromRemote, git, getGitMetadata, normalizeHexSha } from '../src/git.js';
import { buildApprovalPayload, hashApprovalPayload, newApprovalId } from '../src/payload.js';
import { readConfig, writeConfig, requireConfig, CONFIG_FILE } from '../src/config.js';
import { createPgStore } from '../src/store-pg.js';
import { verifyApprovalSignature } from '../src/attestation.js';

function repoSlug(meta) {
  return `${meta.host}/${meta.owner}/${meta.name}`;
}

function hoursFromNow(hours) {
  return new Date(Date.now() + Number(hours) * 60 * 60 * 1000).toISOString();
}

async function withStore(fn) {
  const store = createPgStore();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

const program = new Command();
program
  .name('safegit')
  .description('Safe-backed Git approval CLI with Postgres shared state')
  .version('0.1.0');

program.command('migrate')
  .description('Create/update SafeGit Postgres tables')
  .action(async () => {
    await withStore((store) => store.migrate());
    console.log('SafeGit Postgres schema ready');
  });

program.command('init')
  .description('Register this repo and write .safegit.yml')
  .requiredOption('--safe <address>', 'Safe smart account address')
  .requiredOption('--chain-id <id>', 'Safe chain ID')
  .option('--threshold <n>', 'required signatures', '1')
  .action(async (opts) => {
    const remote = git(['remote', 'get-url', 'origin']);
    const repo = repoSlugFromRemote(remote);
    const safeAddress = getAddress(opts.safe);
    const chainId = Number(opts.chainId);
    const threshold = Number(opts.threshold);
    if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('chain-id must be a positive integer');
    if (!Number.isInteger(threshold) || threshold <= 0) throw new Error('threshold must be a positive integer');

    const config = { app: { name: 'SafeGit' }, repo, safe: { address: safeAddress, chainId, threshold } };
    writeConfig(config);

    await withStore(async (store) => {
      await store.migrate();
      await store.upsertRepo({ ...repo, safeAddress, chainId, threshold });
    });

    console.log(`Wrote ${CONFIG_FILE}`);
    console.log(`Registered ${repo.host}/${repo.owner}/${repo.name} -> Safe ${safeAddress} (threshold ${threshold})`);
  });

program.command('request')
  .description('Create/update a Safe approval request for a commit')
  .option('--ref <ref>', 'git ref to approve', 'HEAD')
  .option('--expires-hours <hours>', 'approval expiry in hours', '24')
  .action(async (opts) => {
    const config = requireConfig();
    const meta = getGitMetadata({ ref: opts.ref });
    const approvalId = newApprovalId(meta.commitSha);
    const createdAt = new Date().toISOString();
    const expiresAt = hoursFromNow(opts.expiresHours);
    const payload = buildApprovalPayload({
      repoHost: meta.host,
      repoOwner: meta.owner,
      repoName: meta.name,
      branch: meta.branch,
      commitSha: meta.commitSha,
      treeSha: meta.treeSha,
      parentShas: meta.parentShas,
      author: meta.author,
      committer: meta.committer,
      safeAddress: config.safe.address,
      chainId: config.safe.chainId,
      approvalId,
      createdAt,
      expiresAt
    });
    const messageHash = hashApprovalPayload(payload);
    const commitSha = normalizeHexSha(meta.commitSha);
    const slug = repoSlug(meta);

    await withStore(async (store) => {
      await store.migrate();
      await store.upsertRepo({ ...meta, safeAddress: config.safe.address, chainId: config.safe.chainId, threshold: config.safe.threshold });
      await store.createApprovalRequest({ repoSlug: slug, approvalId, commitSha, branch: meta.branch, payload, messageHash, expiresAt });
    });

    console.log(JSON.stringify({ approvalId, repoSlug: slug, commitSha, branch: meta.branch, messageHash, payload }, null, 2));
  });

program.command('attest')
  .description('Attach a Safe owner signature to an approval request')
  .requiredOption('--approval-id <id>', 'approval id')
  .requiredOption('--signer <address>', 'signer address')
  .requiredOption('--signature <hex>', 'signature bytes')
  .action(async (opts) => {
    await withStore(async (store) => {
      const approval = await store.getApproval(opts.approvalId);
      if (!approval) throw new Error(`Unknown approval: ${opts.approvalId}`);
      const verification = await verifyApprovalSignature({ payload: approval.payload, signer: getAddress(opts.signer), signature: opts.signature });
      if (!verification.valid) throw new Error(`Invalid signature: ${verification.reason}`);
      const repo = await store.getRepo(approval.repoSlug);
      if (!repo) throw new Error(`Missing repo config: ${approval.repoSlug}`);
      await store.addSignature({ approvalId: opts.approvalId, signer: verification.recovered, signature: opts.signature });
      const updated = await store.markApprovedIfThresholdMet(opts.approvalId, repo.threshold);
      console.log(JSON.stringify({ approvalId: updated.approvalId, status: updated.status, signatures: updated.signatures.length }, null, 2));
    });
  });

program.command('status')
  .description('Show Safe approval status for a commit')
  .option('--ref <ref>', 'git ref to inspect', 'HEAD')
  .action(async (opts) => {
    const meta = getGitMetadata({ ref: opts.ref });
    const slug = repoSlug(meta);
    const commitSha = normalizeHexSha(meta.commitSha);
    await withStore(async (store) => {
      const approval = await store.getApprovalByCommit(slug, commitSha);
      if (!approval) {
        console.log(JSON.stringify({ repoSlug: slug, commitSha, status: 'missing' }, null, 2));
        return;
      }
      console.log(JSON.stringify({
        approvalId: approval.approvalId,
        repoSlug: slug,
        commitSha,
        branch: approval.branch,
        status: approval.status,
        signatures: approval.signatures.map((sig) => sig.signer),
        messageHash: approval.messageHash
      }, null, 2));
    });
  });

program.command('verify')
  .description('Exit 0 only if commit has approved SafeGit attestation')
  .option('--ref <ref>', 'git ref to inspect', 'HEAD')
  .action(async (opts) => {
    const meta = getGitMetadata({ ref: opts.ref });
    const slug = repoSlug(meta);
    const commitSha = normalizeHexSha(meta.commitSha);
    await withStore(async (store) => {
      const approval = await store.getApprovalByCommit(slug, commitSha);
      if (!approval || approval.status !== 'approved') {
        console.error(`SafeGit verification failed for ${slug}@${commitSha}: ${approval?.status || 'missing'}`);
        process.exitCode = 1;
        return;
      }
      console.log(`SafeGit verified ${slug}@${commitSha} via ${approval.approvalId}`);
    });
  });

program.parseAsync().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
