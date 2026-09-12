# ADR-0017: Use one implementation plus risk-based independent probes by default

- Status: accepted
- Decision: [D-037](../11-open-decisions.md)

## Decision

Default verification is one implementation, deterministic checks, and one independent semantic review. Risk decides any further probes. Several complete implementations of one ticket are never the default.

## Consequences

- Review cost is bounded and inspectable.
- Structural independence matters more than the number of agents.

## Alternatives considered

Executor self-review; a fixed second-model review; N-version implementation of every change; human review of everything.
