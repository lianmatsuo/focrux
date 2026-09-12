-- 0041: normalise stored email addresses.
BEGIN;
UPDATE users SET email = lower(email);
COMMIT;
