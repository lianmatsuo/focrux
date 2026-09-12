# ADR-0030: Neutralise repository-supplied agent configuration at handover

- Status: accepted
- Extends: [ADR-0023](0023-untrusted-context-boundary.md)

## Context

Coding agents discover configuration from their working directory: hooks, tool servers, memory files, skills, subagents and plugins. That configuration is committed to the repository, so it is attacker-controlled under the threat model of [ADR-0023](0023-untrusted-context-boundary.md). A hook is arbitrary code execution, and a tool server is an unmediated egress channel. Neither passes through the runner's allow-list, because both run inside the agent process the runner started.

## Decision

**No repository-supplied agent configuration reaches the executor or the reviewer.** Every adapter meets three requirements:

1. **Suppress at invocation.** The agent is invoked so that it does not read project-scoped configuration at all.
2. **Withhold from the worktree.** Every known configuration path is moved out of the worktree before handover and restored afterwards, journalled before the first move, so an interrupted attempt is recoverable at the next start. This covers conventions an adapter does not know about.
3. **Assert what loaded.** No tool server may be connected or attempted, and nothing may load from a path inside the worktree; otherwise the attempt ends with `agent_configuration_present`. User-scoped configuration on the person's own machine is `trust: user` and outside this record.

Agent configuration is immutable during an attempt ([D-045](../11-open-decisions.md)). The runner pins the provider base URL; repository configuration cannot set it. No repository instruction file reaches the executor ([D-094](../11-open-decisions.md)).

### Claude Code

The executor is invoked with:

```text
--setting-sources user          project settings and .mcp.json are not read; subscription login survives
--strict-mcp-config --mcp-config {"mcpServers":{}}
--settings <the attempt's write-guard hook, and no other hook>
--disable-slash-commands        no skills
env CLAUDE_CODE_DISABLE_CLAUDE_MDS=1, CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
--permission-mode manual --allowedTools … --disallowedTools …
never passed: --add-dir, --plugin-dir, --plugin-url, --dangerously-skip-permissions
```

The reviewer's Claude transport also passes `--safe-mode`. The executor cannot, because it turns off the hook that delivers the write guard.

### Codex

Codex runs with a temporary, mode-0700 `CODEX_HOME` that links only the existing `auth.json`, and with inherited `CODEX_*` and `OPENAI_*` variables removed. Shell tools, unified exec and multi-agent support are off at process start. Startup is refused when the thread reports any instruction source. The reviewer runs in an ephemeral thread in a scratch directory with a read-only sandbox and no repository tool; a file it asks for goes through the same reader, with the same refusals, as every other transport. The executor's native tools are answered by the runner's guard ([ADR-0033](0033-focrux-local-desktop-and-subscription-providers.md)).

### The person's own sessions

`focrux agent` and `focrux interview` start the person's own session, which runs under the person's own configuration and is not neutralised. That session reaches the queue's endpoint ([D-109](../11-open-decisions.md)); the executor never does. Subagents, which are decided and not built, stay inside these boundaries: repository and personal agent definitions remain unreachable ([ADR-0038](0038-subagents.md)).

## Consequences

- The largest unmediated execution and egress channel is closed, and the closure is tested rather than asserted.
- An agent that can neither suppress nor report its configuration cannot be an adapter.
- A repository's own agent conventions never reach the executor ([D-094](../11-open-decisions.md)).

## Alternatives considered

Trusting repository agent configuration because the repository is the person's own: rejected, because a contributor's pull request is the obvious vector. Sandboxing the agent process instead: complementary, and not available at the needed strength on the local provider ([ADR-0004](0004-local-first-runner.md)). Linting repository configuration instead of suppressing it: a parser per convention per vendor, failing open on anything unrecognised.

## Validation

Adversarial fixtures commit a hostile hook, a hostile tool-server definition, a provider base-URL override, and an instruction file that tries to widen scope. Each must fail closed, and the run must be observably free of repository-supplied configuration.
