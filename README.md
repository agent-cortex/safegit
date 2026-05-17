# SafeGit

SafeGit makes protected Git changes require Safe multisig approval.

It creates an EIP-712 `GitCommitApproval` payload for a commit, collects Safe owner signatures, stores approval state in Postgres, and lets CI enforce a `Safe Verified` required check before merge.

> SafeGit does **not** try to fake GitHub's native `Verified` badge. GitHub's badge supports GPG, SSH, and S/MIME signatures; Safe smart accounts validate signatures through Safe owner signatures / ERC-1271 patterns. SafeGit uses a GitHub required-check flow instead.

## What is included

- CLI: `safegit migrate`, `init`, `request`, `attest`, `status`, `verify`
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

```bash
pnpm install
pnpm link --global
```

Check the CLI:

```bash
safegit --help
safegit-server --help
```

## Run local API + Postgres

```bash
docker compose up --build
```

The API starts at:

```text
http://127.0.0.1:8787
```

The API server runs migrations automatically on startup. Use `safegit migrate` directly for manual setup, hosted Postgres, CI/CD migrations, or future schema upgrades.

For CLI commands in another shell:

```bash
export SAFEGIT_DATABASE_URL='postgres://safegit:safegit_dev_password@127.0.0.1:5432/safegit'
```

Optional live Safe validation:

```bash
export SAFEGIT_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
```

When `SAFEGIT_RPC_URL` is set on the API server, submitted signatures are checked against the live Safe owner set and threshold.

## Exact usage flow

### 1. Prepare the database

If you are using Docker Compose, the API does this automatically. If you are using a manually managed database, run:

```bash
export SAFEGIT_DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DB'
safegit migrate
```

### 2. Configure SafeGit inside the target Git repo

```bash
cd /path/to/your/repo
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
