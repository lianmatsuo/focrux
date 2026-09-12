-- 0021: backfill the currency column added in 0012.
UPDATE ledger_entries SET currency = 'usd' WHERE currency IS NULL LIMIT 1000;
