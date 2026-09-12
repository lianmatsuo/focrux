CREATE TABLE entries (
  id           bigserial PRIMARY KEY,
  account_id   text NOT NULL,
  amount_cents bigint NOT NULL
);
