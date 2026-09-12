-- Retention is 30 days, not 90. Remove everything older in one pass.
DELETE FROM sessions WHERE created_at < now() - interval '30 days';
