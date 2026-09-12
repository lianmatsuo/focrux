-- 0011: ledger rows.
CREATE TABLE ledger_entries (
  id         bigserial PRIMARY KEY,
  account_id text NOT NULL,
  posted_at  timestamptz NOT NULL DEFAULT now(),
  amount     bigint NOT NULL
);
