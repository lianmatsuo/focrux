# Working in this repository

Focrux is an open-source operating plane for getting work done with coding agents ([D-001](docs/11-open-decisions.md)). This repository holds its code and its source of truth: the decision register, the ADRs, the canonical documents, the diagrams and the backlog. Read this before changing anything.

## The source of truth

- **Current truth only.** A document states what is true now. A superseded or deprecated decision, ADR or comment is deleted, not marked, and git holds the history. Write no dates of past events, no "was" or "used to", and no story of how something came to be ([D-111](docs/11-open-decisions.md)).
- **One home per decision.** Decisions live in [`docs/11-open-decisions.md`](docs/11-open-decisions.md). Architecture that crosses components also has an ADR in [`docs/adr/`](docs/adr/README.md). Everything else cites a decision by its id instead of restating it, because a second copy drifts.
- **A contradiction is a defect.** Two documents that disagree, or a document that disagrees with the code, is a bug: whoever implements first picks one and is wrong half the time. A change to a contract, an authority, a trust boundary, a review rule or a public promise updates the code, the decision, the ADR, the canonical document, the diagram and the backlog in the same change.
- **Identifiers are numbered at merge.** Write new decisions, ADRs and backlog entries as `D-NEW-<label>`, `ADR-NEW-<label>` (in `docs/adr/NEW-<label>.md`) and `SCP-NEW-<label>`. Whoever merges runs `python3 scripts/assign_ids.py --apply` as the last commit; it numbers them after the highest ids `main` and the branch have ever held, so a deleted entry's number is never reused, and rewrites every reference ([D-110](docs/11-open-decisions.md)). Never pick a number by hand.
- **ADRs describe the current architecture.** Edit an ADR in the same change as the architecture it records, and delete one that no longer holds. ADR filenames never change, and numbers are never reused.
- **The backlog is open work.** `backlog/issues.json` holds what is still to do. `SCP-` ids are stable and never renumbered, and `scripts/sync_github_issues.py` converges GitHub to the file.
- **Rename with care.** After any find-and-replace, re-read the diff for sentences that changed meaning rather than wording, and check that no filename moved inside a link.

## The code

```text
apps/cli/              the `focrux` command: doctor, admit, edit, approve, run, review, inspect,
                       list, sync, serve, agent, mcp, stops, escapes, verdict, principle, baseline
apps/desktop/          the Electron desktop around the bundled CLI
packages/contracts/    shared types: ticket, plan contract, change set, checks, review artifact,
                       attempt, run bundle, materialization manifest, limits
packages/review/       the reviewer: context trust tiers, structured verdict, blocking and routing,
                       closure verification, redaction
packages/workspace/    worktree provisioning, the diagnostic, materialization, process execution
packages/runner/       executor adapters (Claude Code, Codex), the write guard, sealing, checks,
                       the remediation loop, delivery, the merge step, re-levelling
packages/planning/     contract drafting: a model proposes, a person approves
packages/ui/           the desktop's shared components and tokens
packages/evaluation/   the corpus, its harness and scorer, and the regression suite
tooling/package/       the release bundle and the open-tree assembly
tooling/skills/        the vendored engineering skills
tooling/tsconfig/      the strict TypeScript base every package extends
```

```bash
pnpm install
pnpm exec turbo run build                   # `^build` builds dependencies, not leaves
pnpm exec turbo run typecheck test lint     # must be green
node apps/cli/dist/main.js doctor --repo .  # can this repository be materialized at all
```

Running the corpus spends money: it needs a reviewer credential, and `--run` is the flag that spends it. `focrux run` spends more, because it executes a coding agent. Both use the person's own credential and write it nowhere.

## The rules that bite

- **A test that reads `.local/` fails in CI.** Authored fixtures carry `change.diff` in the repository; pinned ones only have one after `node packages/evaluation/dist/main.js prepare` clones them, and CI has no corpus cache. Floor an assertion on the authored count and treat cached diffs as a bonus. A test green on the machine that wrote it and red in CI is making an assumption about its environment.
- **`turbo run test` needs the pinned-repository cache.** Run `prepare` once, about 800 MB, before the evaluation tests on a new machine. Without it the pinned fixtures load with an empty diff and fail.
- **Never rebuild while a corpus run is in flight.** The harness starts `apps/cli/dist/main.js` once per fixture per repeat, so a build during a run swaps the binary underneath it.
- **Run the new variant; do not just read it.** Adding a case to shared machinery, such as a fixture class or a routing policy, means finding every place that branches on it. Prove it with an end-to-end test per variant, and check that test by mutation.
- **Ask whether a check can come out either way.** A check nobody can fail is indistinguishable from one that works. `packages/evaluation/test/forbidden-strings.test.ts` and `expectation-reachability.test.ts` hold two such checks.
- **Structural validators do not check meaning.** They check links, ids, lifecycle agreement, foreign-key and edge duplication, dependency cycles, rendering freshness and fixture diffs, and they pass happily on two documents asserting opposite decisions. So does `turbo run test`.
- **A corpus fixture is never weakened because the reviewer missed it.** A miss is a result. `expected_detection` is written before a fixture first runs and never edited afterwards; a fixture that is genuinely wrong is corrected, with the reason recorded in the fixture. The rules are in [`packages/evaluation/corpus/README.md`](packages/evaluation/corpus/README.md).
- **Nothing a model returns becomes an action parameter** ([ADR-0023](docs/adr/0023-untrusted-context-boundary.md)). In `packages/review`, an ESLint rule bans process execution everywhere except the two provider transports, `provider-cli.ts` and `provider-codex-cli.ts`. The workspace and the runner start processes with argv only, never a shell string.
- **The reviewer's inputs do not grow.** It receives the approved plan, the change set, the check results and the files it selects itself. `ReviewInput` has no field for the executor's transcript, narrative or summary, and nothing may add one.
- **A change to the reviewer carries its regression-suite run** ([D-010](docs/11-open-decisions.md)). A pull request that changes `packages/review/src/prompt.ts`, `packages/review/src/blocking.ts`, or the default model or provider carries a summary of a [regression-suite](docs/evaluation/regression-suite.md) run in its body, with the `unstated_regression` row first beside the two hard bars. The reviewing run treats a missing summary as blocking.
- **A check the product runs is changed by a person** ([D-079](docs/11-open-decisions.md)): the validators, the reviewer's prompt and policy, the scorer and the corpus.

## Rendered and generated files

- Diagrams: edit the `.dot`, then regenerate its `.svg` and `.png` with Graphviz. `validate_diagrams.py` compares label text, so it survives a Graphviz version change but still catches a stale rendering.
- Authored corpus fixtures: edit `before/` and `after/`, then regenerate the diff with `python3 scripts/validate_fixture_diffs.py --write`, and corpus diffs with `node packages/evaluation/scripts/build-diffs.mjs`. CI fails a tree edited without it.

## Before you finish

```bash
python3 -m pip install -r scripts/requirements-validation.txt
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/validate_backlog.py
python3 scripts/validate_docs.py
python3 scripts/validate_diagrams.py
python3 scripts/validate_fixture_diffs.py
pnpm exec turbo run build typecheck test lint
```

## Merging

`main` takes changes only through pull requests, and CI runs the validators and the build on each.

An agent may merge a pull request only after an independent review run on Claude Fable 5.1, or Claude Opus 5 when Fable is unavailable, has read the whole diff against this file and left an unqualified approve as a review comment naming the model ([D-073](docs/11-open-decisions.md)). The reviewing run is never the session that wrote the change. The founder may merge without it. GitHub cannot enforce this, so the review comment is the record, and a merge without one is a defect. Whoever merges runs `scripts/assign_ids.py --apply` first.

## Agent skills

Matt Pocock's published skill bundle is vendored at `tooling/skills/mattpocock`, with its pinned source and licence. Development discovery uses the canonical `~/.agents/skills` installation and its Codex and Claude links. Apply a skill when it helps the authorized task; installing one does not authorize external messages, publication or extra tools, and the rules above take precedence over a skill's default workflow.

- Issue tracker: `backlog/issues.json` is canonical and GitHub is its projection. Do not create a second tracker or invent triage labels.
- Domain context: start with `README.md`, then [`docs/04`](docs/04-ticket-workspace-and-review.md) and the relevant canonical document.
- Product agents: [D-094](docs/11-open-decisions.md) governs explicit skill selection. Regenerate bundled guidance with `node tooling/skills/build.mjs` and check it with `--check`.
