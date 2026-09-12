# ADR-0005: Agents communicate through typed artifacts, not unbounded chat

- Status: accepted

## Decision

Plans, change sets, checks, findings, reviews and run bundles have committed, versioned schemas in `packages/contracts`. Chat may be a surface, but it is never the system of record.

## Consequences

Automation is testable and auditable. Schema evolution and structured-output validation are first-class work.
