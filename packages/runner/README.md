# @focrux/runner

The half of execution that is not the agent.

- `profile.ts` — the A2b permission profile: the command allow-list, the deny list, the environment
  built from an allow-list rather than scrubbed by a deny-list, and the pinned provider base URL.
- `adapter.ts` — the Claude Code adapter (`adapter-codex.ts` is the Codex one). It builds an argv rather than assembling one,
  records it on the attempt with the prompt removed from the hash, and **asserts** that the agent
  loaded nothing originating in the repository (ADR-0030).
- `quarantine.ts` — the other half of ADR-0030: every known agent-configuration path moved out of
  the worktree before handover and restored afterwards, journalled before the first move so an
  interrupted attempt is recoverable.
- `ceilings.ts` — wall clock, commands, iterations, tokens and cost, enforced by the runner rather
  than requested of the model, each terminating with a typed reason.
- `prohibited.ts` — the prohibited-action list, detected on commands *and* on the sealed paths,
  because a file write is not a command.
- `seal.ts` — the change set, with materialized secrets removed by content hash rather than by name.
- `bundle.ts` — immutable, content-addressed run bundles with a computed replayability tier.
- `delivery.ts` — push and pull request through local `git` and `gh`. The runner holds the
  credential; the agent never sees a token; nothing here merges.
- `loop.ts` — contract → worktree → agent → seal → checks → review → route → pull request.

One hazard worth knowing before you choose a `worktree_root`: **a worktree nested inside another
package manager's workspace inherits it.** `pnpm` resolves its workspace root by walking up, so a
worktree created under a directory that has a `pnpm-workspace.yaml` above it will fail every install
and every `pnpm exec` with exit 254, and the failure names neither the worktree nor the workspace.
Put the root somewhere with no package manager above it.

The remediation round is the part worth reading twice. It is a **new attempt**: a new record, a new
commit, a new `(base, head)` pair and a new review, and the reviewer grading the answer is never
told that anything it is reading was written in answer to a finding.
