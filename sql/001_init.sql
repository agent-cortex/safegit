CREATE TABLE IF NOT EXISTS safegit_repos (
  slug TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  safe_address TEXT NOT NULL,
  chain_id BIGINT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safegit_approval_requests (
  approval_id TEXT PRIMARY KEY,
  repo_slug TEXT NOT NULL REFERENCES safegit_repos(slug) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  payload JSONB NOT NULL,
  message_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_slug, commit_sha)
);

CREATE TABLE IF NOT EXISTS safegit_signatures (
  approval_id TEXT NOT NULL REFERENCES safegit_approval_requests(approval_id) ON DELETE CASCADE,
  signer TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (approval_id, signer)
);

CREATE INDEX IF NOT EXISTS safegit_approval_requests_repo_status_idx
  ON safegit_approval_requests(repo_slug, status);
