-- Subscriptions referenced plans that no longer exist after the plan cleanup.
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES plans (id);
