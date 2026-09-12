CREATE TABLE orders (
  id           text PRIMARY KEY,
  account_id   text NOT NULL,
  total_cents  bigint NOT NULL
);
