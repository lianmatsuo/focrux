-- 0006: usage rows for the metered plan.
CREATE TABLE usage_events (
  id          bigserial PRIMARY KEY,
  account_id  text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  units       integer NOT NULL
);
