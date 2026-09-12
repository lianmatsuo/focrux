# inventory

Fetches stock levels from the upstream inventory service, retrying transient
failures with capped, jittered backoff.
