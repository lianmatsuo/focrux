-- Entries become multi-currency. The application writes `currency` from this
-- release; this migration backfills the rows that predate it.
ALTER TABLE entries ADD COLUMN currency text;

UPDATE entries
   SET currency = accounts.default_currency
  FROM accounts
 WHERE accounts.id = entries.account_id
   AND entries.currency IS NULL;

ALTER TABLE entries ALTER COLUMN currency SET NOT NULL;
