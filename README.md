# SafeGit

SafeGit makes protected Git changes require Safe multisig approval.

It creates an EIP-712 `GitCommitApproval` payload for a commit, collects Safe owner signatures, stores approval state in Postgres, and lets CI enforce a `Safe Verified` required check before merge.

> SafeGit does **not** try to fake GitHub's native `Verified` badge. GitHub's badge supports GPG, SSH, and S/MIME signatures; Safe smart accounts validate signatures through Safe owner signatures / ERC-1271 patterns. SafeGit uses a GitHub required-check flow instead.

## What is included

- CLI: `safegit env`, `doctor`, `migrate`, `init`, `request`, `attest`, `status`, `verify`
- HTTP API for approval retrieval and signature submission
- Built-in browser approval page at `/approve/:approvalId`
- Postgres shared state for repos, approval requests, and signatures
- EIP-712 typed-data payload generation
- Signature recovery with `viem.recoverTypedDataAddress`
- Optional live Safe `getOwners()` / `getThreshold()` validation via RPC
- Docker Compose for local API + Postgres
- GitHub Action template for a `Safe Verified` required check
- pnpm-only package management

## Architecture

```text
Developer CLI
  -> Postgres shared approval state
  -> SafeGit API + approval page
  -> Safe owners sign EIP-712 typed data
  -> optional live Safe owner/threshold validation
  -> GitHub Action runs safegit verify
  -> branch protection requires Safe Verified
```

## Requirements

- Node.js 22+
- pnpm 11+
- Git
- Postgres 17+ or Docker Compose
- A Safe address and threshold
- Optional but recommended: RPC URL for the Safe's chain

## Install locally

SafeGit is pnpm-only.

Run these commands from the SafeGit CLI package directory, the directory that contains `package.json` and `bin/safegit.js`.

```bash
pnpm install
```

Check the local entrypoints before linking globally:

```bash
pnpm safegit -- --help
pnpm run safegit:server -- --help
```

Link the CLI globally when you want to run `safegit init` from arbitrary target repos:

```bash
pnpm link:global
hash -r
```

Check the global shims:

```bash
safegit --help
safegit-server --help
```

If `safegit migrate` or `safegit init` fails with `Cannot find module '.../bin/safegit.js'`, the global shim was linked from the wrong directory or an older checkout. Re-run `pnpm link:global` from the CLI package directory and clear the shell command cache with `hash -r`. On pnpm 11+, the underlying command is `pnpm link --global .`; the trailing `.` is required.

Without a global link, use the bin path directly from any target repo:

```bash
node /absolute/path/to/safegit/bin/safegit.js init --safe 0xYourSafeAddress --chain-id 11155111 --threshold 2
```

## Run local API + Postgres

```bash
docker compose up --build
```

The API starts at:

```text
http://127.0.0.1:8787
```

Postgres is published on the host at `127.0.0.1:15432` by default so it does not collide with an existing developer-machine Postgres on `5432`. Override the host port with `SAFEGIT_POSTGRES_HOST_PORT` before running Docker Compose.

The API server runs migrations automatically on startup. Use `safegit migrate` directly for manual setup, hosted Postgres, CI/CD migrations, or future schema upgrades.

For CLI commands in another shell:

```bash
safegit env
safegit doctor
```

This creates `.env` in the current directory with the Docker Compose database URL, `postgres://safegit:safegit_dev_password@127.0.0.1:15432/safegit`, if `SAFEGIT_DATABASE_URL` is missing. `safegit doctor` validates the URL, DNS, and TCP connectivity. Use `safegit env --database-url 'postgres://USER:PASSWORD@HOST:5432/DB'` for a hosted or manually managed database. If an existing `.env` contains a stale or malformed value, use `safegit env --force`.

Optional live Safe validation:

```bash
export SAFEGIT_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
```

When `SAFEGIT_RPC_URL` is set on the API server, submitted signatures are checked against the live Safe owner set and threshold.

## Exact usage flow

### 1. Prepare the database

If you are using Docker Compose, the API does this automatically. If you are using a manually managed database, run:

```bash
safegit env --database-url 'postgres://USER:PASSWORD@HOST:5432/DB'
safegit doctor
safegit migrate
```

### 2. Configure SafeGit inside the target Git repo

```bash
cd /path/to/your/repo
safegit env
safegit init \
  --safe 0xYourSafeAddress \
  --chain-id 11155111 \
  --threshold 2
```

This writes `.safegit.yml` and stores the repo → Safe mapping in Postgres.

### 3. Create an approval request for a commit

```bash
safegit request --ref HEAD
```

This creates a `GitCommitApproval` EIP-712 payload containing:

- repo host, owner, and name
- branch
- commit SHA
- tree SHA and parent SHAs
- author and committer
- Safe address
- chain ID
- approval ID
- creation and expiry timestamps

The command prints an `approvalId` like:

```text
appr_5f4074bfbf53
```

### 4. Open the approval page

```text
http://127.0.0.1:8787/approve/<approvalId>
```

The page:

1. loads the backend-provided EIP-712 payload
2. connects an injected wallet
3. calls `eth_signTypedData_v4`
4. posts `{ signer, signature }` to the SafeGit API
5. marks the approval `approved` after the configured threshold is reached

### 5. Check status

```bash
safegit status --ref HEAD
```

Before enough signatures:

```json
{
  "status": "pending"
}
```

After threshold:

```json
{
  "status": "approved"
}
```

### 6. Enforce approval in CI

```bash
safegit verify --ref HEAD
```

`verify` exits non-zero unless the commit is approved. Use that as a GitHub required check.

## Manual signature submission

If you collect a signature elsewhere, submit it manually:

```bash
safegit attest \
  --approval-id appr_xxxxxx \
  --signer 0xSignerAddress \
  --signature 0xSignatureBytes
```

Or through the API:

```bash
curl -X POST http://127.0.0.1:8787/api/approvals/appr_xxxxxx/signatures \
  -H 'content-type: application/json' \
  -d '{
    "signer": "0xSignerAddress",
    "signature": "0xSignatureBytes"
  }'
```

## API endpoints

```text
GET  /healthz
GET  /approve/:approvalId
GET  /api/approvals/:approvalId
POST /api/approvals/:approvalId/signatures
```

## Production hardening

SafeGit's approval page is intentionally small, but a public deployment should still sit behind basic controls.

### API bearer token

Set `SAFEGIT_API_TOKEN` to require `Authorization: Bearer <token>` on all `/api/*` routes:

```bash
export SAFEGIT_API_TOKEN='replace-with-a-long-random-token'
```

The browser approval page still renders at `/approve/:approvalId`. If API auth is enabled, signers can either paste the token into the page once or open:

```text
https://safegit.example.com/approve/<approvalId>#token=<token>
```

Do not put this token in GitHub Actions logs, public issues, or screenshots.

### Rate limits and CORS

By default, `/api/*` routes are limited to 60 requests per minute per IP. Tune with:

```bash
export SAFEGIT_RATE_LIMIT_WINDOW_MS=60000
export SAFEGIT_RATE_LIMIT_MAX=60
```

Lock CORS to your deployed origin instead of `*`:

```bash
export SAFEGIT_CORS_ORIGIN='https://safegit.example.com'
```

### Reverse proxy

For production, terminate HTTPS at a reverse proxy such as Caddy, Nginx, Cloudflare Tunnel, Fly, Render, or a platform load balancer. Keep Postgres private, rotate `SAFEGIT_API_TOKEN`, and enable platform-level request logging/rate limits too. If the service is behind one trusted proxy, set:

```bash
export SAFEGIT_TRUST_PROXY=true
```

This makes per-IP rate limiting use the forwarded client IP instead of the proxy's IP.

### Live Safe validation

Set `SAFEGIT_RPC_URL` so submitted signatures are checked against live `getOwners()` / `getThreshold()` before they count:

```bash
export SAFEGIT_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
```

For rigorous historical validation, use an archival RPC and verify owner/threshold state at the relevant chain block for the protected change. The MVP validates current Safe ownership; that is enough for demos and most active approvals, not for backdated forensic guarantees.

### GitHub App roadmap

The MVP uses a GitHub Action required check because it is simple and works today. A future GitHub App should add webhook-triggered check-runs, centralized repo configuration, audit pages, and secretless installation UX.

## GitHub Actions required check

The repo includes:

```text
action.yml
templates/github-action.yml
```

Example workflow:

```yaml
name: Safe Verified
on: [pull_request]

jobs:
  safe-verified:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: agent-cortex/safegit@main
        with:
          database-url: ${{ secrets.SAFEGIT_DATABASE_URL }}
          ref: HEAD
```

Then require the `Safe Verified` check in GitHub branch protection.

## What Postgres stores

- `safegit_repos` — repo slug, host, owner, repo name, Safe address, chain ID, threshold
- `safegit_approval_requests` — commit SHA, branch, EIP-712 payload, message hash, status, expiry
- `safegit_signatures` — signer address, signature, timestamp

## Testing

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm pack --dry-run
```

## GitHub App status

A GitHub App is not required to test SafeGit. The current MVP uses a GitHub Action required check.

A future GitHub App would improve production UX by creating check-runs directly from push/PR webhooks, centralizing repo configuration, and avoiding manual workflow setup.

## Security notes

- Do not commit private keys, RPC secrets, database passwords, or `.env` files.
- Use a real shared Postgres database for team usage; local DBs are only for demos.
- For production, run the API behind auth/rate limits.
- Enable `SAFEGIT_RPC_URL` if you want live Safe owner/threshold validation.
- For rigorous historical validation, verify the Safe owner set at the relevant block.

## License

MIT
