# ADR-0038: An executor may delegate to subagents inside its attempt

- Status: accepted; not built
- Decision: [D-106](../11-open-decisions.md)
- Extends: [ADR-0030](0030-neutralise-repository-supplied-agent-configuration.md)

## Context

The runner assumes one session making calls in order. The write guard keeps its working-directory state in one file without a lock, command records carry no agent, and the executor's last message becomes its account. Claude's `Task` tool is disallowed, and Codex runs with `agents.enabled=false`. Claude Code runs settings-file hooks inside subagents; in Codex, a spawned agent is its own thread, whose approvals reach the app-server client tagged with that thread.

## Decision

On both transports, the executor may start subagents from roles Focrux defines. The runner enforces only the trust boundaries:

- every subagent write passes the ticket's scope guard;
- repository and personal agent definitions stay unreachable;
- every subagent's activity is recorded against it;
- the reviewer receives none of it.

## Consequences

- The write guard keeps state per agent, and records name the agent.
- The executor's account is the top-level session's alone.
- Codex usage is summed per thread.
- Each subagent receives the brief again after a compaction.
- Codex needs version 0.145.0 or later.

## Alternatives considered

- No subagents.
- The runner running each node as its own attempt.
- A per-node write limit enforced by the guard.
- Product-set limits on concurrency and nesting.

## Reversal trigger

A subagent write escapes the scope guard, or a subagent's account reaches review.
