# ADR-0007: Use one product monorepo, trunk-based delivery, and ticket worktrees

- Status: accepted

## Decision

Focrux is developed in one monorepo, with short-lived branches in their own worktrees, pull requests to `main`, and checks on every pull request. The loop's own attempts run in worktrees too.

## Consequences

Parallel agent work stays isolated while integration stays continuous. An agent's merge to `main` follows [D-073](../11-open-decisions.md).
