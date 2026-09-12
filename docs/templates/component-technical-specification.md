# Component Technical Specification: <Name>

- Status: draft | proposed | accepted | implemented | deprecated
- Owners:
- Related ADRs:
- Related backlog issues:
- Phase/tier:
- Last reviewed:

## 1. Outcome and scope

What user or operating outcome does this component own? What is explicitly outside its boundary?

## 2. Responsibilities and invariants

List owned responsibilities, invariants, prohibited behaviours and non-goals.

## 2a. Trust boundary

Does this component place repository, connector or other untrusted content in front of a model, or turn model output into an action parameter? If so, state the trust tiers, where instruction/data separation is enforced, and which deterministic result takes precedence over a model claim (ADR-0023). If not, say "no untrusted input" explicitly.

## 3. Domain model

Owned entities, value objects, identifiers, relationships and lifecycle/state machine.

## 4. Commands, queries and events

For each contract include schema/version, authorisation, idempotency, inputs, outputs, errors and emitted events.

## 5. State transitions

Document valid transitions, guards, side effects, retries and terminal states.

## 6. Data and persistence

Tables, indexes, constraints, retention, encryption, migration and rebuild strategy.

## 7. Integrations and source authority

Provider adapters, authoritative fields, sync direction, credentials, rate limits, reconciliation, conflicts and degradation behaviour.

## 8. Security, privacy and autonomy

Permissions, sensitivity, model exposure, action class, policy checks, approvals, audit and kill switches.

## 9. Cost

What a run of it costs, how that cost is recorded, and the hard stops that bound it.

## 10. Reliability and operations

SLOs, observability, alerts, runbooks, retries, idempotency, backup/recovery and failure injection.

## 11. Planning and review contract

Required plan level, context inputs, deterministic checks, independent probes, rollout and outcome observation.

## 12. Evaluation plan

Fixtures, metrics, thresholds, shadow/canary strategy, false-positive tolerance and reversal trigger.

## 13. Rollout and rollback

Feature flags, migrations, compatibility, staged rollout, rollback or forward recovery.

## 14. Unresolved decisions

Decision ID, owner, default assumption, evidence required and blocking milestone.
