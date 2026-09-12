# Planning mode and execution graphs

How large work goes through Focrux as one ticket. None of it is built yet. The decisions are in [the register](11-open-decisions.md): [D-100](11-open-decisions.md), [D-101](11-open-decisions.md), [D-102](11-open-decisions.md), [D-103](11-open-decisions.md), [D-105](11-open-decisions.md), [D-106](11-open-decisions.md), [D-096](11-open-decisions.md), [D-104](11-open-decisions.md), [D-107](11-open-decisions.md) and [D-015](11-open-decisions.md). The architecture is in [ADR-0037](adr/0037-execution-graph.md) and [ADR-0038](adr/0038-subagents.md), the terms are in [CONTEXT.md](../CONTEXT.md), and a clickable prototype shows the layout on sample data. The work is in [the backlog](../backlog/issues.json); each entry's notes name the decision it builds.

## In one paragraph

Large work stays one ticket. Its plan may group its acceptance criteria into nodes, an execution graph, which a person curates and approves once, and the executor may hand parts of it to subagents of its own. The intent behind it is a spec, written in an interview between the person and their own agent session, kept in the repository and committed with the change. The desktop gains planning mode: Create moves into the rail and opens Spec, Explorer, Graph and Impact panes for one piece of work. Runs have no cost, token or wall-clock ceiling; a stall detector stops a hang, and a graph is checked and reviewed per node, and once over the whole change.

## The flow

1. **Create** (⌘1) opens planning mode, and the person picks the repository.
2. **Interview.** The person's own Claude Code or Codex session questions them in a chat docked beside every planning pane, and writes the spec, with any `CONTEXT.md` and ADR changes.
3. **Generate plan.** Pressed once in the chat. The session brings the spec up to date with the conversation, the drafter turns it into a contract and a suggested execution graph, and one ticket is admitted in `plan_review`.
4. **Refine by editing.** The person edits the graph by hand, marks paths in the explorer and reads impact warnings, and keeps talking in the chat. What they ask for there is applied to the plan and the spec as edits, each shown as a before-and-after they can undo. Nothing is generated again unless the person starts over from the spec.
5. **Approve** once.
6. **Run.** The loop commits the spec first, with a generated page for each node beside it. The executor works, starting subagents if it chooses, and receives its brief again after every compaction. The pinned checks run per node, narrowed to its paths, review runs per node and once overall, and the graph shows each node's state from the records.
7. **Deliver** as any ticket does: the pull request carries the spec with the change.

## Trust boundary

- **Data, not instruction.** The spec reaches the drafter delimited, as an issue does; `CONTEXT.md`, ADR titles and `principles.md` reach it as repository data ([D-035](11-open-decisions.md)). Impact warnings go to the person, not to a model.
- **Action parameters.** Node paths, prohibited paths and criteria become action parameters only through the person's approval ([D-072](11-open-decisions.md)). A path marked in the explorer is the person's own choice.
- **Deterministic precedence.** The write guard, the seal and the reviewer's deterministic scope check outrank any model claim. A node's state during a run comes from the sealed change set and review coverage, never from the executor's account.
- **The interview session** is the person's own and is not neutralised, but its writes are confined to planning files, and it cannot approve, publish or merge.
- **Plan edits.** Before approval the interview changes the draft plan only through the validated edit path, which records its author, so the edit count still measures what a person changed.
- **Review inputs do not grow.** The spec commit sits below the reviewed diff, No-Gos stay in the approach, and subagent transcripts never reach review.

## Out of scope

- Interview providers beyond Claude Code and Codex.
- Phone surfaces for planning mode.
- Editing code in Focrux ([D-015](11-open-decisions.md)).
- Semantic end-to-end tests, database branching and just-in-time secrets; the environment contract ([ADR-0025](adr/0025-worktree-environment-contract.md)) owns that ground.
