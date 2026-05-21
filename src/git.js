import { execFileSync, spawn } from 'node:child_process';

export function normalizeHexSha(sha) {
  const stripped = String(sha || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(stripped)) {
    throw new Error('Expected a git sha with 40 hex chars');
  }
  return `0x${stripped.toLowerCase()}`;
}

export function repoSlugFromRemote(remote) {
  const value = String(remote || '').trim();
  let match = value.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    match = value.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  }
  if (!match) {
    throw new Error(`Unsupported git remote URL: ${remote}`);
  }
  return { host: match[1], owner: match[2], name: match[3] };
}

export function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function runGitPassthrough(args, { cwd = process.cwd(), env = process.env, stdio = 'inherit' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env, stdio });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

export function getGitMetadata({ cwd = process.cwd(), ref = 'HEAD' } = {}) {
  const remote = git(['remote', 'get-url', 'origin'], cwd);
  const repo = repoSlugFromRemote(remote);
  const branch = git(['rev-parse', '--abbrev-ref', ref], cwd);
  const commitSha = git(['rev-parse', ref], cwd);
  const treeSha = git(['show', '-s', '--format=%T', ref], cwd);
  const parentLine = git(['show', '-s', '--format=%P', ref], cwd);
  const author = git(['show', '-s', '--format=%an <%ae>', ref], cwd);
  const committer = git(['show', '-s', '--format=%cn <%ce>', ref], cwd);
  return {
    ...repo,
    branch,
    commitSha,
    treeSha,
    parentShas: parentLine ? parentLine.split(/\s+/) : [],
    author,
    committer
  };
}
