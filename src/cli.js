import { Command } from 'commander';
import { getAddress } from 'viem';
import { repoSlugFromRemote, git, getGitMetadata, normalizeHexSha } from './git.js';
import { newApprovalId } from './payload.js';
import { writeConfig, requireConfig, CONFIG_FILE } from './config.js';
import { createPgStore } from './store-pg.js';
import { submitApprovalSignature } from './approval-service.js';
import { createCommitApprovalRequest, repoSlugFromMetadata } from './approval-request-service.js';

function hoursFromNow(hours, now = new Date()) {
  return new Date(now.getTime() + Number(hours) * 60 * 60 * 1000).toISOString();
}

export function normalizeArgv(argv) {
  if (argv[2] !== '--') return argv;
  return [...argv.slice(0, 2), ...argv.slice(3)];
}

export function createCliProgram({
  createStore = createPgStore,
  gitCommand = git,
  getMetadata = getGitMetadata,
  loadConfig = requireConfig,
  saveConfig = writeConfig,
  now = () => new Date(),
  newId = newApprovalId,
  stdout = console.log,
  stderr = console.error,
  setExitCode = (code) => {
    process.exitCode = code;
  }
} = {}) {
  async function withStore(fn) {
    const store = createStore();
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
      stdout('SafeGit Postgres schema ready');
    });

  program.command('init')
    .description('Register this repo and write .safegit.yml')
    .requiredOption('--safe <address>', 'Safe smart account address')
    .requiredOption('--chain-id <id>', 'Safe chain ID')
    .option('--threshold <n>', 'required signatures', '1')
    .action(async (opts) => {
      const remote = gitCommand(['remote', 'get-url', 'origin']);
      const repo = repoSlugFromRemote(remote);
      const safeAddress = getAddress(opts.safe);
      const chainId = Number(opts.chainId);
      const threshold = Number(opts.threshold);
      if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('chain-id must be a positive integer');
      if (!Number.isInteger(threshold) || threshold <= 0) throw new Error('threshold must be a positive integer');

      const config = { app: { name: 'SafeGit' }, repo, safe: { address: safeAddress, chainId, threshold } };
      saveConfig(config);

      await withStore(async (store) => {
        await store.migrate();
        await store.upsertRepo({ ...repo, safeAddress, chainId, threshold });
      });

      stdout(`Wrote ${CONFIG_FILE}`);
      stdout(`Registered ${repo.host}/${repo.owner}/${repo.name} -> Safe ${safeAddress} (threshold ${threshold})`);
    });

  program.command('request')
    .description('Create/update a Safe approval request for a commit')
    .option('--ref <ref>', 'git ref to approve', 'HEAD')
    .option('--expires-hours <hours>', 'approval expiry in hours', '24')
    .action(async (opts) => {
      const config = loadConfig();
      const meta = getMetadata({ ref: opts.ref });
      const approvalId = newId(meta.commitSha);
      const createdAt = now();
      const expiresAt = hoursFromNow(opts.expiresHours, createdAt);

      await withStore(async (store) => {
        const result = await createCommitApprovalRequest({
          store,
          config,
          metadata: meta,
          approvalId,
          createdAt,
          expiresAt
        });
        stdout(JSON.stringify(result, null, 2));
      });
    });

  program.command('attest')
    .description('Attach a Safe owner signature to an approval request')
    .requiredOption('--approval-id <id>', 'approval id')
    .requiredOption('--signer <address>', 'signer address')
    .requiredOption('--signature <hex>', 'signature bytes')
    .action(async (opts) => {
      await withStore(async (store) => {
        const result = await submitApprovalSignature({
          store,
          approvalId: opts.approvalId,
          signer: opts.signer,
          signature: opts.signature
        });
        stdout(JSON.stringify({ approvalId: result.approvalId, status: result.status, signatures: result.signatures.length }, null, 2));
      });
    });

  program.command('status')
    .description('Show Safe approval status for a commit')
    .option('--ref <ref>', 'git ref to inspect', 'HEAD')
    .action(async (opts) => {
      const meta = getMetadata({ ref: opts.ref });
      const slug = repoSlugFromMetadata(meta);
      const commitSha = normalizeHexSha(meta.commitSha);
      await withStore(async (store) => {
        const approval = await store.getApprovalByCommit(slug, commitSha);
        if (!approval) {
          stdout(JSON.stringify({ repoSlug: slug, commitSha, status: 'missing' }, null, 2));
          return;
        }
        stdout(JSON.stringify({
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
      const meta = getMetadata({ ref: opts.ref });
      const slug = repoSlugFromMetadata(meta);
      const commitSha = normalizeHexSha(meta.commitSha);
      await withStore(async (store) => {
        const approval = await store.getApprovalByCommit(slug, commitSha);
        if (!approval || approval.status !== 'approved') {
          stderr(`SafeGit verification failed for ${slug}@${commitSha}: ${approval?.status || 'missing'}`);
          setExitCode(1);
          return;
        }
        stdout(`SafeGit verified ${slug}@${commitSha} via ${approval.approvalId}`);
      });
    });

  return program;
}

export async function runCli({ argv = process.argv, exit = process.exit, stderr = console.error } = {}) {
  try {
    await createCliProgram({ stderr }).parseAsync(normalizeArgv(argv));
  } catch (error) {
    stderr(error.message || error);
    exit(1);
  }
}
