import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';
import { createCliProgram, formatCliError, normalizeArgv, runCli } from '../src/cli.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/safegit.js');
const serverCli = path.join(root, 'bin/safegit-server.js');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const compose = YAML.parse(readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'));

function runCliBin(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

function runServerCli(args) {
  return spawnSync(process.execPath, [serverCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000
  });
}

test('CLI accepts pnpm script separator before help option', () => {
  const result = runCliBin(['--', '--help']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage: safegit/);
  assert.match(result.stdout, /Commands:/);
});

test('CLI program can be constructed without executing the bin entrypoint', () => {
  const program = createCliProgram();
  const commands = program.commands.map((command) => command.name()).sort();

  assert.deepEqual(commands, ['approval', 'attest', 'doctor', 'env', 'init', 'migrate', 'request', 'setup', 'sign', 'verify']);
  assert.deepEqual(normalizeArgv(['node', 'safegit', '--', '--help']), ['node', 'safegit', '--help']);
});

test('runCli delegates git-shaped commands to git with the original arguments', async () => {
  const calls = [];
  const exits = [];

  for (const args of [
    ['add', 'src/index.js'],
    ['commit', '-m', 'wrap git commit'],
    ['status', '--short'],
    ['branch', '--show-current'],
    ['init']
  ]) {
    await runCli({
      argv: ['node', 'safegit', ...args],
      runGitCommand: async (gitArgs) => {
        calls.push(gitArgs);
        return 0;
      },
      exit: (code) => exits.push(code),
      stdout: () => {},
      stderr: () => {}
    });
  }

  assert.deepEqual(calls, [
    ['add', 'src/index.js'],
    ['commit', '-m', 'wrap git commit'],
    ['status', '--short'],
    ['branch', '--show-current'],
    ['init']
  ]);
  assert.deepEqual(exits, []);
});

test('runCli exits with the git status when passthrough git command fails', async () => {
  const exits = [];

  await runCli({
    argv: ['node', 'safegit', 'add', 'missing.txt'],
    runGitCommand: async () => 128,
    exit: (code) => exits.push(code),
    stdout: () => {},
    stderr: () => {}
  });

  assert.deepEqual(exits, [128]);
});

test('push verifies SafeGit approval before delegating to git push', async () => {
  const gitCalls = [];
  const storeCalls = [];
  const store = {
    async getApprovalByCommit(repoSlug, commitSha) {
      storeCalls.push(['getApprovalByCommit', repoSlug, commitSha]);
      return { approvalId: 'appr_push', status: 'approved' };
    },
    async close() {
      storeCalls.push(['close']);
    }
  };

  await runCli({
    argv: ['node', 'safegit', 'push', 'origin', 'main'],
    createStore: () => store,
    getMetadata: () => ({
      host: 'github.com',
      owner: 'megabyte0x',
      name: 'demo',
      branch: 'main',
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      parentShas: [],
      author: 'Megabyte <m@example.com>',
      committer: 'Megabyte <m@example.com>'
    }),
    runGitCommand: async (args) => {
      gitCalls.push(args);
      return 0;
    },
    stdout: () => {},
    stderr: () => {}
  });

  assert.deepEqual(storeCalls, [
    ['getApprovalByCommit', 'github.com/megabyte0x/demo', '0x' + 'a'.repeat(40)],
    ['close']
  ]);
  assert.deepEqual(gitCalls, [['push', 'origin', 'main']]);
});

test('push blocks git push when HEAD does not have approved SafeGit approval', async () => {
  const gitCalls = [];
  const errors = [];
  const exits = [];
  const store = {
    async getApprovalByCommit() {
      return { approvalId: 'appr_push', status: 'pending' };
    },
    async close() {}
  };

  await runCli({
    argv: ['node', 'safegit', 'push'],
    createStore: () => store,
    getMetadata: () => ({
      host: 'github.com',
      owner: 'megabyte0x',
      name: 'demo',
      branch: 'main',
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      parentShas: [],
      author: 'Megabyte <m@example.com>',
      committer: 'Megabyte <m@example.com>'
    }),
    runGitCommand: async (args) => {
      gitCalls.push(args);
      return 0;
    },
    exit: (code) => exits.push(code),
    stdout: () => {},
    stderr: (line) => errors.push(line)
  });

  assert.deepEqual(gitCalls, []);
  assert.deepEqual(exits, [1]);
  assert.match(errors.join('\n'), /SafeGit verification failed/);
  assert.match(errors.join('\n'), /pending/);
});

test('package exposes local CLI scripts for development without a global shim', () => {
  assert.equal(packageJson.scripts.safegit, 'node ./bin/safegit.js');
  assert.equal(packageJson.scripts['safegit:server'], 'node ./bin/safegit-server.js');
  assert.equal(packageJson.scripts['link:global'], 'pnpm link --global .');
});

test('server entrypoint prints help without opening the database or listener', () => {
  const result = runServerCli(['--help']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage: safegit-server/);
  assert.match(result.stdout, /SafeGit API server/);
});

test('env command writes SAFEGIT_DATABASE_URL when it is missing', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'safegit-env-'));
  const stdout = [];
  try {
    const program = createCliProgram({
      cwd,
      env: {},
      stdout: (line) => stdout.push(line)
    });

    await program.parseAsync(['node', 'safegit', 'env', '--database-url', 'postgres://example']);

    assert.equal(readFileSync(path.join(cwd, '.env'), 'utf8'), 'SAFEGIT_DATABASE_URL=postgres://example\n');
    assert.match(stdout[0], /Added SAFEGIT_DATABASE_URL to .env/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('env command defaults to the non-conflicting Docker Compose host port', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'safegit-env-'));
  try {
    const program = createCliProgram({
      cwd,
      env: {},
      stdout: () => {}
    });

    await program.parseAsync(['node', 'safegit', 'env']);

    assert.equal(
      readFileSync(path.join(cwd, '.env'), 'utf8'),
      'SAFEGIT_DATABASE_URL=postgres://safegit:safegit_dev_password@127.0.0.1:15432/safegit\n'
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('env command leaves existing SAFEGIT_DATABASE_URL unchanged', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'safegit-env-'));
  const stdout = [];
  try {
    writeFileSync(path.join(cwd, '.env'), 'SAFEGIT_DATABASE_URL=postgres://existing\nSAFEGIT_PORT=8787\n', 'utf8');
    const program = createCliProgram({
      cwd,
      env: {},
      stdout: (line) => stdout.push(line)
    });

    await program.parseAsync(['node', 'safegit', 'env', '--database-url', 'postgres://new']);

    assert.equal(readFileSync(path.join(cwd, '.env'), 'utf8'), 'SAFEGIT_DATABASE_URL=postgres://existing\nSAFEGIT_PORT=8787\n');
    assert.match(stdout[0], /SAFEGIT_DATABASE_URL already exists in .env/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('env command can replace an existing SAFEGIT_DATABASE_URL in the env file', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'safegit-env-'));
  const stdout = [];
  try {
    writeFileSync(path.join(cwd, '.env'), 'SAFEGIT_DATABASE_URL=postgress://test:test@local:5432/DB\nSAFEGIT_PORT=8787\n', 'utf8');
    const program = createCliProgram({
      cwd,
      env: {
        SAFEGIT_DATABASE_URL: 'postgress://test:test@local:5432/DB'
      },
      stdout: (line) => stdout.push(line)
    });

    await program.parseAsync(['node', 'safegit', 'env', '--force']);

    assert.equal(
      readFileSync(path.join(cwd, '.env'), 'utf8'),
      'SAFEGIT_DATABASE_URL=postgres://safegit:safegit_dev_password@127.0.0.1:15432/safegit\nSAFEGIT_PORT=8787\n'
    );
    assert.match(stdout[0], /Updated SAFEGIT_DATABASE_URL in .env/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Docker Compose publishes Postgres on the same non-conflicting host port the CLI writes', () => {
  assert.deepEqual(compose.services.postgres.ports, ['${SAFEGIT_POSTGRES_HOST_PORT:-15432}:5432']);
});

test('doctor reports malformed database URLs and unresolved hosts with actionable output', async () => {
  const stdout = [];
  const exitCodes = [];
  const program = createCliProgram({
    env: {
      SAFEGIT_DATABASE_URL: 'postgress://test:test@local:5432/DB'
    },
    lookupHost: async () => {
      const error = new Error('getaddrinfo ENOTFOUND local');
      error.code = 'ENOTFOUND';
      throw error;
    },
    connectTcp: async () => {},
    stdout: (line) => stdout.push(line),
    setExitCode: (code) => exitCodes.push(code)
  });

  await program.parseAsync(['node', 'safegit', 'doctor']);

  const output = stdout.join('\n');
  assert.equal(exitCodes.at(-1), 1);
  assert.match(output, /SAFEGIT_DATABASE_URL must use postgres:\/\/ or postgresql:\/\//);
  assert.match(output, /Database host "local" could not be resolved/);
  assert.match(output, /Run `safegit env --database-url/);
});

test('doctor confirms a reachable database URL', async () => {
  const calls = [];
  const stdout = [];
  const program = createCliProgram({
    env: {
      SAFEGIT_DATABASE_URL: 'postgres://safegit:safegit_dev_password@127.0.0.1:15432/safegit'
    },
    lookupHost: async (host) => calls.push(['lookup', host]),
    connectTcp: async (input) => calls.push(['connect', input.host, input.port]),
    stdout: (line) => stdout.push(line)
  });

  await program.parseAsync(['node', 'safegit', 'doctor']);

  assert.deepEqual(calls, [
    ['lookup', '127.0.0.1'],
    ['connect', '127.0.0.1', 15432]
  ]);
  assert.match(stdout.join('\n'), /SafeGit doctor passed/);
});

test('CLI error formatting points database DNS failures at doctor', () => {
  const error = new Error('getaddrinfo ENOTFOUND local');
  error.code = 'ENOTFOUND';
  error.hostname = 'local';

  assert.equal(
    formatCliError(error),
    'Database host "local" could not be resolved. Run safegit doctor to inspect SAFEGIT_DATABASE_URL.'
  );
});

test('request command persists only repo config fields before creating approval', async () => {
  const calls = [];
  const stdout = [];
  const store = {
    async migrate() {
      calls.push(['migrate']);
    },
    async upsertRepo(input) {
      calls.push(['upsertRepo', input]);
    },
    async createApprovalRequest(input) {
      calls.push(['createApprovalRequest', input]);
    },
    async close() {
      calls.push(['close']);
    }
  };
  const program = createCliProgram({
    createStore: () => store,
    loadConfig: () => ({
      safe: {
        address: '0x0000000000000000000000000000000000000001',
        chainId: 11155111,
        threshold: 2
      }
    }),
    getMetadata: () => ({
      host: 'github.com',
      owner: 'megabyte0x',
      name: 'demo',
      branch: 'main',
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      parentShas: [],
      author: 'Megabyte <m@example.com>',
      committer: 'Megabyte <m@example.com>'
    }),
    newId: () => 'appr_cli',
    now: () => new Date('2026-05-17T08:00:00.000Z'),
    stdout: (line) => stdout.push(line)
  });

  await program.parseAsync(['node', 'safegit', 'request', '--expires-hours', '2']);

  assert.deepEqual(calls[1], ['upsertRepo', {
    host: 'github.com',
    owner: 'megabyte0x',
    name: 'demo',
    safeAddress: '0x0000000000000000000000000000000000000001',
    chainId: 11155111,
    threshold: 2
  }]);
  assert.equal(calls[2][1].approvalId, 'appr_cli');
  assert.equal(calls[2][1].createdAt, '2026-05-17T08:00:00.000Z');
  assert.equal(calls[2][1].expiresAt, '2026-05-17T10:00:00.000Z');
  assert.match(stdout[0], /"approvalId": "appr_cli"/);
});

test('sign command creates an approval request for HEAD and returns the approval URL', async () => {
  const stdout = [];
  const store = {
    async migrate() {},
    async upsertRepo() {},
    async createApprovalRequest() {},
    async close() {}
  };
  const program = createCliProgram({
    createStore: () => store,
    loadConfig: () => ({
      safe: {
        address: '0x0000000000000000000000000000000000000001',
        chainId: 11155111,
        threshold: 2
      }
    }),
    getMetadata: ({ ref }) => {
      assert.equal(ref, 'HEAD');
      return {
        host: 'github.com',
        owner: 'megabyte0x',
        name: 'demo',
        branch: 'main',
        commitSha: 'a'.repeat(40),
        treeSha: 'b'.repeat(40),
        parentShas: [],
        author: 'Megabyte <m@example.com>',
        committer: 'Megabyte <m@example.com>'
      };
    },
    newId: () => 'appr_sign',
    now: () => new Date('2026-05-17T08:00:00.000Z'),
    env: {
      SAFEGIT_APPROVAL_BASE_URL: 'https://safe.example'
    },
    stdout: (line) => stdout.push(line)
  });

  await program.parseAsync(['node', 'safegit', 'sign']);

  const output = JSON.parse(stdout[0]);
  assert.equal(output.approvalId, 'appr_sign');
  assert.equal(output.approvalUrl, 'https://safe.example/approve/appr_sign');
});
