-- 0007: verification timestamp for the new activation flow.
ALTER TABLE users ADD COLUMN verified_at timestamptz NOT NULL;

CREATE INDEX idx_users_verified_at ON users (verified_at);
