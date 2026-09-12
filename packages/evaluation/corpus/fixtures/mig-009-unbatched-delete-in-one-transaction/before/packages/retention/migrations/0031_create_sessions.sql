CREATE TABLE sessions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
