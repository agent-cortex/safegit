#!/usr/bin/env node

const userAgent = process.env.npm_config_user_agent || '';
const execPath = process.env.npm_execpath || '';
const pnpmHome = process.env.PNPM_HOME || '';
const isPnpm =
  userAgent.startsWith('pnpm/') ||
  userAgent.includes(' pnpm/') ||
  execPath.includes('pnpm') ||
  pnpmHome.includes('pnpm');

if (!isPnpm) {
  console.error('SafeGit uses pnpm only. Run: pnpm install');
  process.exit(1);
}
