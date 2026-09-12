-- Units overflowed a 32-bit integer for the largest accounts.
ALTER TABLE usage_events ALTER COLUMN units TYPE bigint;
