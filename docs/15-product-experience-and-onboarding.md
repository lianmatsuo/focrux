# Product Experience and Onboarding

## First run

From the repository, run `./scripts/setup-local.mjs` (`node scripts/setup-local.mjs` on Windows). It checks Node 22+ and Git, fetches the pinned pnpm, installs dependencies, builds the CLI and the desktop, and opens Focrux; `--no-launch` builds without opening a window.

Inside Focrux:

1. Enter a name. It is stored on this machine and stamped on the tickets you admit — no account is created and nothing is sent anywhere.
2. Sign in to Claude Code and/or Codex through their own CLIs (`claude auth login`, `codex login`). Focrux runs on whichever subscription is already signed in and needs no API key ([D-093](11-open-decisions.md)). Choose executor and reviewer models from what each CLI reports.
3. Choose a repository already checked out on this machine — nothing is cloned. Run its environment check and save the proposed configuration; setup will not finish until that completes.

Re-running the setup script preserves your name, repositories and provider logins. The CLI it builds keeps tickets, contracts and evidence under `.focrux/` in whichever repository you point it at.

## The desktop

### Home and creating a task

Home lists the tickets Focrux owns, with a count of what needs you and what has completed. Search (⌘K) matches title, key, branch or repository; filters narrow to what needs you, what's running or what's completed; sort is newest, oldest or title. Each card carries its stage, branch, repository and diff size (`+added −removed · files`, or "no diff yet" before a first run) — its ticket key shows as `#142`, with the `FCX-` prefix dropped. A ticket needing you is marked and carries the primary button.

**Create a task** opens with a repository, one sentence for the outcome, and the executor and reviewer models (your defaults, changeable for this task). From there you either write the acceptance criteria yourself or have a model draft them from what you wrote — through the same path `admit --from-file` uses for a real issue, so what comes back is proven against your outcome rather than restating its title; drafting spends against your subscription, writing them yourself does not. Either way you land on the compiled contract before anything runs, with up to four criteria, each pairing what must be proven with the assertion that proves it (test, query, metric or artifact), and an allowed scope of path globs with headroom for a few files beyond them; paths the repository always refuses stay listed and out of reach. Edits in progress are saved on the device and restored if you leave and come back ([D-095](11-open-decisions.md)).

Decided, not built: Create moves into the rail and opens planning mode — Spec, Explorer, Graph, Impact, running alongside a run — and a `focrux interview` session drafts the spec, `CONTEXT.md` and ADRs for a person to approve ([D-101](11-open-decisions.md), [D-102](11-open-decisions.md)).

### The contract editor and approval

The contract shows the outcome, each criterion with its expected evidence, the allowed and prohibited paths, the base commit, the executor and reviewer models, up to three engineering skills for the executor ([D-094](11-open-decisions.md)), and this run's ceilings. Approving freezes four fields — outcome, criteria, scope, base — for good; how the work gets done stays the agent's. A checkbox asks whether to push the branch and open a pull request once the review gate passes; you still merge it yourself. Approving here is exactly `focrux approve`, run for you before the loop starts. A contract that has never run can be deleted outright; one that has keeps its record.

### The run view and the review result

The loop screen names what's happening now against six stages — contract, execution, checks, decisions required, refinement, review — with a running description of steps taken and a strip of commands used, cost spent and files touched against this run's ceilings; no time estimate is invented. From here you can open the worktree in your editor, stop the loop, or watch the agents' own output: a transcript of executor and reviewer turns, a terminal pane, and the changed files — recorded output, not evidence. The reviewer never reads the executor's narrative.

Once the gate closes, the review screen shows each criterion's verification strength and evidence location, the deterministic checks, and any open findings, with cost and elapsed time beside them; you can send a finding back for another look, export the evidence, or return to the contract to retry. If a pull request was authorized, the merge screen asks one question — merge or don't — with the verified-criteria count, the checks, the scope and the base commit beside it; the desktop opens your browser to GitHub and never merges the pull request itself. Either way the ticket returns you to Home with what changed.

### Completed tickets and the archive

A ticket stays on Home, marked complete, once it merges or closes — nothing files it away on its own. Archiving it, one at a time or all at once, moves it to the Archive: a searchable, filterable, sortable table with a diff column and CSV export, and a ticket filed by mistake returns to Home in one click.

### Settings, shortcuts and themes

The settings icon opens a pill of three sections. **General** holds your name, what can interrupt you and how (below), appearance — light, dark or system; text size; reduced motion — and AFK mode, which holds the machine awake for as long as a run or a decision is live. **Usage** answers whether you can start another ticket: each connected provider's own plan windows where it reports them, and this machine's ledger — spend this month, tickets run and stopped at a ceiling, average cost per merged ticket — read from retained attempt records, with unpriced attempts marked rather than guessed. **Connections** holds provider sign-in and refresh, default models per role, this machine's default ceilings, and repositories with their environment check and off-limits paths.

Every keyboard binding is rebindable per machine from Settings → General → Shortcuts: click one and press the new combination; a combination already in use is refused and named rather than silently taken. Approving a contract and opening a pull request stay fixed, since they are the two actions that spend money or write to your repository.

Decided, not built: a phone companion once pairing lands ([D-097](11-open-decisions.md)).

### When the loop interrupts you

The loop pauses for you only on a real decision — never for routine progress. One question at a time, with its evidence and, where the executor offered them, a few concrete options plus "let it decide" or your own words in a sentence; every answer stays editable until you confirm the whole set, and confirming resumes the run. Outside a live decision, Focrux only notifies on four things — a decision is needed, a review finishes, a ceiling stops the loop, or any stage changes — never on progress alone, and never twice for the same fact.

## The same work, from the command line

Everything above has a `focrux` command behind it, for scripting or a repository with no desktop open.

- **`focrux admit`** — one piece of work into a ticket and its contract, in `plan_review`. Type `--outcome`, `--criterion` and `--path` yourself, or let a model draft them from a GitHub issue (`--from owner/repo#412`) or a Markdown file (`--from-file issue.md`) — the same path the desktop's own drafting button uses with what you typed. Nothing runs until the draft is approved.
- **`focrux edit FCX-142`** — open the contract in `$VISUAL`/`$EDITOR`, or pass `--outcome`/`--criterion`/`--path` to change one part directly. Only while the ticket is in `plan_review`.
- **`focrux approve FCX-142`** — freezes the contract from that moment.
- **`focrux run --ticket FCX-142 [--publish]`** — provisions a worktree, executes, seals the change, runs the pinned checks, reviews independently, routes remediable findings back to the executor, and with `--publish` opens the pull request. A person still merges it.
- **`focrux inspect FCX-142 [--attempt <id>]`** — every attempt read back: how it ended, cost, checks, the review and where each finding went; `--verify` recomputes an attempt's stored hashes instead of reading it.
- **`focrux list [--all]`** — the admitted work and where each ticket stands.
- **`focrux sync FCX-142 [--merge]`** — reads the pull request, its checks and its stop answers from GitHub onto the ticket; `--merge` additionally merges it, but only where the repository has opted into `merge: loop` and a separate review run has approved that exact head ([D-041](11-open-decisions.md)).
- **`focrux stops`** — precision of stopping, read live from the answers on pull requests: of the changes with an answer, the share a person endorsed, beside the share of changes a person was shown anything on, and beside it the share of merges that went out unattended.
- **`focrux escapes`** — of the tickets that merged: how many were reverted, and how many separately had a touched path changed again within fourteen days.
- **`focrux serve`** — the queue over the ticket store. Each tick it fetches the base, syncs and, where configured, merges open pull requests in dependency and priority order, starts ready tickets up to the configured concurrency, and drafts tickets from a tracker label if one is configured. While it runs it hosts a local endpoint for your own session.
- **`focrux agent [--provider claude|codex]`** — your own Claude Code or Codex session in the checkout, with that endpoint injected. That session can read every ticket and its evidence, admit new tickets as drafts, edit an unapproved contract, sync a pull request and pause the queue — never approve, publish or merge; that stays a person's keystroke. Needs a running `serve`.
- **`focrux principle add "..."`** — records a product answer no established practice could settle; every later executor brief consults it. This is what the desktop's decision screen writes on your behalf when you answer one.

## What you see, and what the loop handles

The loop is the product; independent review is one step inside it, not the thing you interact with directly ([D-088](11-open-decisions.md)). Admitted work runs end to end — execution, checks, review, repair — and a person sees only what needs a decision ([D-001](11-open-decisions.md)). Every finding the executor can close against an established practice, it closes without you; only a `security.*` or `context.*` finding, a deterministic check that failed, the final remediation round, or a point the executor declares it has no practice for reaches you, in the desktop's decision screen or a pull request's checkboxes ([D-065](11-open-decisions.md)). A person picks the model and provider for Focrux's own review ([D-088](11-open-decisions.md)). Decided, not built: reviews other tools leave on the same pull request are read and routed like Focrux's own findings.
