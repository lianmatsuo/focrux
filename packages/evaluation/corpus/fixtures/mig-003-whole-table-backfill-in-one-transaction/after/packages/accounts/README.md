# Deploying accounts

Migrations run **before** the new application version is released, and the
previous version keeps serving traffic until the rollout completes. A migration
must therefore be safe against the code that is already running.
