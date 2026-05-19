# Security Policy

## Reporting vulnerabilities

Please open a private security advisory on GitHub or contact the maintainer directly.

Do not include private keys, database passwords, RPC credentials, or other secrets in public issues.

## Operational notes

SafeGit signs and verifies offchain EIP-712 approvals. For production use:

- run the API behind HTTPS and a reverse proxy
- set `SAFEGIT_API_TOKEN` for `/api/*` bearer-token protection when signers can receive a shared token safely
- restrict `SAFEGIT_CORS_ORIGIN` to the deployed origin
- set `SAFEGIT_TRUST_PROXY=true` only when exactly one trusted reverse proxy sits in front of the API
- keep the default `/api/*` rate limit enabled, and add platform-level rate limits in front of the service
- use a real shared Postgres database on a private network
- enable `SAFEGIT_RPC_URL` for live Safe owner/threshold checks
- use an archival RPC and block-specific checks for backdated forensic validation
- avoid committing `.env` files, API tokens, database passwords, RPC credentials, or private keys
- prefer dedicated testnet Safes for demos
