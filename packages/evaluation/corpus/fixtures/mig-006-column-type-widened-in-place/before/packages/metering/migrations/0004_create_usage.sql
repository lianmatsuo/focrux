CREATE TABLE usage_events (
  id          bigserial PRIMARY KEY,
  account_id  text NOT NULL,
  units       integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
