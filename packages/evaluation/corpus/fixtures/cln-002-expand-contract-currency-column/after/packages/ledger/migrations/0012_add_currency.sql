-- 0012 (expand): add the column nullable, with a default for new rows only.
-- The backfill and the NOT NULL constraint are 0013 and 0014, after this has
-- been deployed and the writer below is live.
ALTER TABLE ledger_entries ADD COLUMN currency text DEFAULT 'usd';

-- CONCURRENTLY cannot run inside a transaction block; the migration runner is
-- configured to execute this file outside one.
CREATE INDEX CONCURRENTLY idx_ledger_entries_currency
  ON ledger_entries (currency);
