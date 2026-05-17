#!/usr/bin/env node
import 'dotenv/config';
import { createPgStore } from '../src/store-pg.js';
import { createApp } from '../src/server.js';
import { createPublicClient, http } from 'viem';

const port = Number(process.env.PORT || process.env.SAFEGIT_PORT || 8787);
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
