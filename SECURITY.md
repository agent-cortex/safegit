# Security Policy

## Reporting vulnerabilities

Please open a private security advisory on GitHub or contact the maintainer directly.

Do not include private keys, database passwords, RPC credentials, or other secrets in public issues.

## Operational notes

SafeGit signs and verifies offchain EIP-712 approvals. For production use:

- run the API behind authentication and rate limits
- use a real shared Postgres database
- enable `SAFEGIT_RPC_URL` for live Safe owner/threshold checks
- avoid committing `.env` files or private keys
- prefer dedicated testnet Safes for demos
