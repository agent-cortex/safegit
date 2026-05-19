import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCliProgram, normalizeArgv } from '../src/cli.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/safegit.js');

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

test('CLI accepts pnpm script separator before help option', () => {
  const result = runCli(['--', '--help']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage: safegit/);
  assert.match(result.stdout, /Commands:/);
});

test('CLI program can be constructed without executing the bin entrypoint', () => {
  const program = createCliProgram();
  const commands = program.commands.map((command) => command.name()).sort();

  assert.deepEqual(commands, ['attest', 'init', 'migrate', 'request', 'status', 'verify']);
  assert.deepEqual(normalizeArgv(['node', 'safegit', '--', '--help']), ['node', 'safegit', '--help']);
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
