# ADR-0026: State replay guarantees per bundle, and let them degrade honestly

- Status: accepted
- Decision: [D-039](../11-open-decisions.md)

## Context

A bundle that references repository context by commit hash, rather than storing the bytes the model saw, stops being replayable after a force-push, a branch deletion or a repository transfer. A bundle whose model version the provider has retired cannot be replayed through that model. Both failures are silent unless the bundle says so.

## Decision

Every run bundle carries a `replayability` tier, and the tier degrades over time.

| Tier | Meaning | Requires |
|---|---|---|
| `exact` | Deterministic components reproduce byte for byte: normalisers, validators, policy evaluation, scope checks, projections | Pinned code and pinned inputs |
| `re_executable` | The captured context can be run again through a different model, prompt or policy version | The materialized context bytes the model saw, stored by content address |
| `forensic` | What happened can be reconstructed, best effort, tolerating missing dependencies | Bundle metadata only |

`forensic` is the default. A commit reference alone never qualifies for `re_executable`. The current tier is computed, not asserted. Decided, not built: the tier drops visibly when retained inputs expire or a provider retires a model version; until then it is set when the bundle is written ([D-039](../11-open-decisions.md), SCP-085). Bundles stay on the machine that produced them.

## Consequences

- A document or a person can claim only what a bundle's tier supports.
- Investigating a run starts with an honest answer to "can this be reconstructed?".
- Once tiers degrade (SCP-085), some bundles show a dropped tier, and that is the system working.

## Alternatives considered

Claiming uniform replay and handling failures case by case; storing a full repository snapshot for every run; storing nothing beyond metadata.

## Reversal trigger

A replay of a bundle whose source branch was deleted produces a plausible reconstruction instead of reporting the degradation.
