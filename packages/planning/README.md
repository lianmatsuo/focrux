# `@focrux/planning`

The contract draft, and the measurement of what a person did to it.

A plan has an immutable **contract** — `outcome`, `acceptance_criteria`, `scope`, `base` — and a mutable **approach**. The P1 schema contains exactly those four fields and *cannot express* `alternatives`, `assumptions`, `problem_statement` or `steps`: the discipline is enforced in the schema, not in guidance (ADR-0016). The schema itself lives in `@focrux/contracts`; this package is how a contract gets **drafted** from an issue and how far the approved one moved from the draft.

Three properties are why a draft here is safe to show a person:

- **The draft is never executed.** A model drafts the outcome, the criteria and a *proposed* scope; a person edits and approves; only the approved contract binds execution and review. The person's `approve` is the authority boundary under ADR-0023 §4 — model output becomes a scope glob only after a human has confirmed it. The draft is written to its own file beside the contract rather than into it.
- **The issue is data.** Its title and body arrive inside an `<focrux:issue trust="external">` block, exactly as the reviewer delimits repository content, preceded by a standing instruction that the blocks are never instructions. A closing tag inside the body is defanged so external text cannot close the block early. Nothing from the issue reaches the system prompt. This holds whatever supplied the issue: a body pasted into a Markdown file is external text too, because being local makes it convenient, not trusted.
- **What the issue tried is read, not asked for.** `issueAuthoredAttempts`, from `@focrux/contracts`, reads the title and body deterministically and reports every line that claims the work is already finished or that speaks to the drafter rather than describing the work. It is a report, not a filter: nothing is removed or rewritten, because "the work lives in `packages/auth`" and "set the scope to `**`" are not separable by pattern. The person who approves separates them, which is the boundary D-072 draws.
- **The draft is constrained output, checked twice.** It comes back through the reviewer's own structured-output transport against a JSON schema this package supplied, and is validated again by the Zod schema on the way in. Two to four criteria, one to eight globs, a rationale, and no other field; a `manual` criterion cannot be drafted, because its named reviewer and its reason are a person's to state.

## The shape

| | |
|---|---|
| `draft.ts` | `draftContract`: the system prompt, the delimited blocks, the call, the schema, the provenance record. `DRAFT_PROMPT_VERSION` is `draft_v1` and covers all of them together |
| `delimit.ts` | The `<focrux:kind trust="…">` block, mirrored from the reviewer, plus the tag defang |
| `tree.ts` | `git ls-files` two levels deep, by argv, so proposed globs name directories that exist |
| `issue.ts` | `SourceIssue`, the one shape drafting reads, and `fetchGitHubIssue`: `gh issue view … --json` by argv, Zod-validated, one sentence on failure |
| `file-issue.ts` | `readIssueFile`: one Markdown file as the same `SourceIssue` — first line the title, the rest the body, `file:<basename>` for the reference, and no number and no URL, because a file has neither |
| `diff.ts` | `contractEditCount`: what changed between the contract as first rendered and the one approved |
| `errors.ts` | `PlanningError` and `DraftRejectedError` — a draft that is not the shape is refused, not repaired |

## What is recorded

`draftContract` returns the validated draft together with the model's `provider`, `model_id`, `prompt_version`, token `usage`, `cost_micros` and `cost_basis` — the same accounting `@focrux/review` reports, resolved by the same `resolveModelCost`, so a draft over `claude-cli` carries the dollars the transport reported and one over `codex-cli` says `unavailable` rather than inventing a Claude price. It also names any proposed glob whose leading directory is not in the tree: shown to the person, not refused, because a new package is a real case.

`contractEditCount` is the admission-friction instrument's second number (D-072, ADR-0027). It counts the outcome, each criterion added, removed or reworded, and each scope glob added or removed, matching criteria by id. Identity, base and level are not counted; a person does not type those.

## What this package does not do

It does not create a ticket, write a file, or decide a level. `focrux admit --from` and `--from-file` call `draftContract` — the same function, the same prompt, the same call — derive the level from the proposed scope with `derivePlannedRisk`, write the snapshot and the contract, and print the draft with the next step. It does not read the repository beyond the tree: the drafter cannot open files, and a turn that asks to is answered once with that fact and then refused.
