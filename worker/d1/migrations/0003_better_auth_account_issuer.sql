PRAGMA foreign_keys = ON;

-- Better Auth 1.7 uses issuer + accountId as the provider-account identity.
-- This additive repair keeps existing local/preview databases upgradeable.
ALTER TABLE account ADD COLUMN issuer TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_issuer_account ON account(issuer, accountId);
