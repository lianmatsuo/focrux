# payouts

Builds and signs payout webhooks for the settlement provider.

Credentials come from the environment. Nothing in this package should ever hold
a key literal — `config.ts` is the only place that reads `process.env`, so that
a grep for the variable names finds every use.
