CREATE TABLE subscriptions (
  id          bigserial PRIMARY KEY,
  account_id  text NOT NULL,
  plan_id     text NOT NULL
);
