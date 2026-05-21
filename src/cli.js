import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Command } from 'commander';
import { getAddress } from 'viem';
import { repoSlugFromRemote, git, getGitMetadata, normalizeHexSha } from './git.js';
import { newApprovalId } from './payload.js';
import { writeConfig, requireConfig, CONFIG_FILE } from './config.js';
import { createPgStore } from './store-pg.js';
import { submitApprovalSignature } from './approval-service.js';
import { createCommitApprovalRequest, repoSlugFromMetadata } from './approval-request-service.js';

const DEFAULT_DATABASE_URL = 'postgres://safegit:safegit_dev_password@127.0.0.1:15432/safegit';
const DEFAULT_DOCTOR_TIMEOUT_MS = 1000;

function hoursFromNow(hours, now = new Date()) {
  return new Date(now.getTime() + Number(hours) * 60 * 60 * 1000).toISOString();
}

export function normalizeArgv(argv) {
  if (argv[2] !== '--') return argv;
  return [...argv.slice(0, 2), ...argv.slice(3)];
}

function hasEnvKey(contents, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  return contents.split(/\r?\n/).some((line) => pattern.test(line));
}

function readEnvValue(contents, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`);
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match) return match[1].replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function replaceEnvValue(contents, key, value) {
  const lines = contents.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (replaced || !new RegExp(`^\\s*${key}\\s*=`).test(line)) return line;
    replaced = true;
    return `${key}=${value}`;
  });
  return next.join('\n');
}

export function ensureDatabaseUrlEnv({
  cwd = process.cwd(),
  env = process.env,
  file = '.env',
  databaseUrl = DEFAULT_DATABASE_URL,
  force = false
} = {}) {
  const envPath = path.resolve(cwd, file);
  const displayPath = path.relative(cwd, envPath) || path.basename(envPath);

  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (hasEnvKey(current, 'SAFEGIT_DATABASE_URL')) {
    if (force) {
      const next = replaceEnvValue(current, 'SAFEGIT_DATABASE_URL', databaseUrl);
      fs.writeFileSync(envPath, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
      return { status: 'updated', file: displayPath };
    }
    return { status: 'file', file: displayPath };
  }

  if (env.SAFEGIT_DATABASE_URL && !force) {
    return { status: 'environment', file: displayPath };
  }

  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.appendFileSync(envPath, `${separator}SAFEGIT_DATABASE_URL=${databaseUrl}\n`, 'utf8');
  return { status: 'added', file: displayPath };
}

function databaseUrlFromEnv({ cwd, env, file }) {
  if (env.SAFEGIT_DATABASE_URL) return { value: env.SAFEGIT_DATABASE_URL, source: 'SAFEGIT_DATABASE_URL' };
  if (env.DATABASE_URL) return { value: env.DATABASE_URL, source: 'DATABASE_URL' };

  const envPath = path.resolve(cwd, file);
  if (!fs.existsSync(envPath)) return { value: '', source: file };

  const contents = fs.readFileSync(envPath, 'utf8');
  return {
    value: readEnvValue(contents, 'SAFEGIT_DATABASE_URL') || readEnvValue(contents, 'DATABASE_URL'),
    source: path.relative(cwd, envPath) || path.basename(envPath)
  };
}

function defaultConnectTcp({ host, port, timeoutMs = DEFAULT_DOCTOR_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`Timed out connecting to ${host}:${port}`)));
    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}

export async function diagnoseDatabase({
  cwd = process.cwd(),
  env = process.env,
  file = '.env',
  timeoutMs = DEFAULT_DOCTOR_TIMEOUT_MS,
  lookupHost = (host) => dns.lookup(host),
  connectTcp = defaultConnectTcp
} = {}) {
  const checks = [];
  const databaseUrl = databaseUrlFromEnv({ cwd, env, file });
  if (!databaseUrl.value) {
    checks.push({
      status: 'fail',
      message: `Missing SAFEGIT_DATABASE_URL. Run \`safegit env\` or \`safegit env --database-url <postgres-url>\`.`
    });
    return { ok: false, checks };
  }

  checks.push({ status: 'pass', message: `Found database URL in ${databaseUrl.source}` });

  let parsed;
  try {
    parsed = new URL(databaseUrl.value);
  } catch {
    checks.push({ status: 'fail', message: 'SAFEGIT_DATABASE_URL is not a valid URL.' });
    return { ok: false, checks };
  }

  const protocolOk = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (!protocolOk) {
    checks.push({ status: 'fail', message: 'SAFEGIT_DATABASE_URL must use postgres:// or postgresql://.' });
  }

  if (!parsed.hostname) {
    checks.push({ status: 'fail', message: 'SAFEGIT_DATABASE_URL must include a database host.' });
    return { ok: false, checks };
  }

  let hostResolved = false;
  try {
    await lookupHost(parsed.hostname);
    hostResolved = true;
    checks.push({ status: 'pass', message: `Resolved database host "${parsed.hostname}"` });
  } catch (error) {
    checks.push({
      status: 'fail',
      message: `Database host "${parsed.hostname}" could not be resolved (${error.code || error.message}). Run \`safegit env --database-url '${DEFAULT_DATABASE_URL}'\` for the default Docker Compose setup.`
    });
  }

  const port = Number(parsed.port || 5432);
  if (!Number.isInteger(port) || port <= 0) {
    checks.push({ status: 'fail', message: 'SAFEGIT_DATABASE_URL must include a valid database port.' });
    return { ok: false, checks };
  }

  if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && port === 5432) {
    checks.push({
      status: 'warn',
      message: '127.0.0.1:5432 often belongs to a developer machine Postgres. SafeGit Docker Compose publishes Postgres on 127.0.0.1:15432 by default.'
    });
  }

  if (protocolOk && hostResolved) {
    try {
      await connectTcp({ host: parsed.hostname, port, timeoutMs });
      checks.push({ status: 'pass', message: `Connected to ${parsed.hostname}:${port}` });
    } catch (error) {
      checks.push({ status: 'fail', message: `Could not connect to ${parsed.hostname}:${port} (${error.code || error.message}).` });
    }
  }

  return { ok: checks.every((check) => check.status !== 'fail'), checks };
}

export function createCliProgram({
  createStore = createPgStore,
  gitCommand = git,
  getMetadata = getGitMetadata,
  loadConfig = requireConfig,
  saveConfig = writeConfig,
  cwd = process.cwd(),
  env = process.env,
  lookupHost = (host) => dns.lookup(host),
  connectTcp = defaultConnectTcp,
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

  program.command('env')
    .description('Add missing SafeGit environment defaults')
    .option('--database-url <url>', 'Postgres connection string to write when SAFEGIT_DATABASE_URL is missing', DEFAULT_DATABASE_URL)
    .option('--file <path>', 'env file to update', '.env')
    .option('--force', 'replace SAFEGIT_DATABASE_URL in the env file when it already exists')
    .action((opts) => {
      const result = ensureDatabaseUrlEnv({ cwd, env, file: opts.file, databaseUrl: opts.databaseUrl, force: opts.force });
      if (result.status === 'added') {
        stdout(`Added SAFEGIT_DATABASE_URL to ${result.file}`);
      } else if (result.status === 'updated') {
        stdout(`Updated SAFEGIT_DATABASE_URL in ${result.file}`);
      } else if (result.status === 'file') {
        stdout(`SAFEGIT_DATABASE_URL already exists in ${result.file}`);
      } else {
        stdout('SAFEGIT_DATABASE_URL already set in environment');
      }
    });

  program.command('doctor')
    .description('Check SafeGit CLI configuration and database connectivity')
    .option('--file <path>', 'env file to inspect', '.env')
    .option('--timeout-ms <ms>', 'TCP connection timeout in milliseconds', String(DEFAULT_DOCTOR_TIMEOUT_MS))
    .action(async (opts) => {
      const timeoutMs = Number(opts.timeoutMs);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeout-ms must be a positive integer');

      const report = await diagnoseDatabase({ cwd, env, file: opts.file, timeoutMs, lookupHost, connectTcp });
      for (const check of report.checks) {
        stdout(`${check.status.toUpperCase()} ${check.message}`);
      }
      if (report.ok) {
        stdout('SafeGit doctor passed');
      } else {
        setExitCode(1);
      }
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

export function formatCliError(error) {
  if (error?.code === 'ENOTFOUND') {
    const host = error.hostname || String(error.message || '').match(/ENOTFOUND\s+([^\s]+)/)?.[1] || 'database host';
    return `Database host "${host}" could not be resolved. Run safegit doctor to inspect SAFEGIT_DATABASE_URL.`;
  }
  return error.message || String(error);
}

export async function runCli({ argv = process.argv, exit = process.exit, stderr = console.error } = {}) {
  try {
    await createCliProgram({ stderr }).parseAsync(normalizeArgv(argv));
  } catch (error) {
    stderr(formatCliError(error));
    exit(1);
  }
}
