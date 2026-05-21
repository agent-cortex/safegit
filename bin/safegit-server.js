#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { createPgStore } from '../src/store-pg.js';
import { createApp } from '../src/server.js';
import { createPublicClient, http } from 'viem';

const program = new Command();
program
  .name('safegit-server')
  .description('SafeGit API server')
  .version('0.1.0')
  .option('-p, --port <port>', 'HTTP port to listen on', process.env.PORT || process.env.SAFEGIT_PORT || '8787');

program.parse(process.argv);

const port = Number(program.opts().port);
if (!Number.isInteger(port) || port <= 0) {
  program.error('port must be a positive integer');
}

const store = createPgStore();
const provider = process.env.SAFEGIT_RPC_URL ? createPublicClient({ transport: http(process.env.SAFEGIT_RPC_URL) }) : null;
await store.migrate();
const app = createApp({ store, provider });
const server = app.listen(port, () => {
  console.log(`SafeGit API listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
  });
}
