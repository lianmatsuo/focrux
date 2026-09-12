# Contributing

## Sign your work — the Developer Certificate of Origin

There is no contributor licence agreement. Instead every commit carries a
`Signed-off-by` line, which is your statement of the certificate below:

```bash
git commit -s -m "..."
```

The line must use your real name and an address you can be reached at:

```text
Signed-off-by: Jane Doe <jane@example.com>
```

A pull request whose commits are not signed off cannot be merged. The
certificate, verbatim:

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same license (unless I am permitted to submit
    under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Before you open a pull request

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build
pnpm exec turbo run typecheck test lint
python3 scripts/validate_backlog.py
python3 scripts/validate_docs.py
```

That is the gate `.github/workflows/build.yml` runs, and it must be green. The
Python validators need `scripts/requirements-validation.txt` installed; they
check the backlog's ids, labels and dependency graph, and the documentation's
links, ADR numbering and lifecycle states.

The working rules the project holds itself to — how a change is proven, what a
comment is for, what never becomes an action parameter — are in
[`AGENTS.md`](AGENTS.md). It is written for whoever does the work, person or
agent, and it applies to a contributor exactly as it applies to a maintainer.

## A change to the reviewer carries its regression-suite run

Quoted from [`AGENTS.md`](AGENTS.md):

> **A change to the reviewer carries its regression-suite run.** A pull request
> that changes the reviewer prompt (`packages/review/src/prompt.ts`), the
> blocking matrix (`packages/review/src/blocking.ts`) or the default model or
> provider carries in its body a summary of a regression-suite run — thirty
> reviews at one repeat — with the `unstated_regression` row first, beside the
> two hard bars (no flipped verdict, every cited credential redacted), and every
> other row read against the previous suite run on the same model.

The reviewing run treats the summary's absence as a blocking finding. Nothing in
the tree can check a pull-request body, so this is procedural, like the review
comment itself.

The suite runs the evaluation harness in `packages/evaluation` against the
fixture corpus. It calls a model provider and it costs money; run it with your
own key, and quote the result rather than the intention.

## Some files are not yours to change in this pull request

`.github/protected-paths.json` names a short list: the tests that check the
reviewer's blocking, remediation and decision-order behaviour, the runner's
security test, and the sample fixtures the reviewer is scored on
(`packages/evaluation/sample/**`). CI's
`protected-paths` check fails a pull request that edits any of them, naming
the file and why.

The reason is simple even though the mechanism sounds strict: these files are
what a change is judged against, not what a change produces. If the pull
request under review could also loosen the test that would have caught it,
the test proves nothing — and the fixture rule at the bottom of this page is
the same rule, which is why the fixtures are on the list beside the tests. The
one path around this is a maintainer's release commit on the default branch —
this check does not run there, only against a pull request — because a
maintainer is not the party the check exists to hold to account.

The reviewer's own prompt and code are deliberately **not** on that list.
Changing the reviewer is the contribution this project is asking for; the
section above is how such a change is held honest — by the score it carries,
not by a refusal to let it be written.

If your change genuinely needs one of these to move — a real bug in the test,
not a test that is inconvenient for the change you are making — open an issue
and say why, rather than routing around the check.

## The regression suite runs in CI, and a reviewer change reports its delta

`regression-suite` clones the public corpus at the commit
`.github/corpus-pin.json` names. What happens next depends on what the pull
request changed, and the difference between the two is money.

**Always: the dry run.** The harness resolves the suite's thirty fixture ids
against the pinned corpus (`--suite regression`, no `--run`). It calls no
model and costs nothing, and it fails only if a fixture id the suite names is
missing from the pinned corpus commit — which would mean the pin and the suite
have drifted apart. It is not the suite's score.

**When the pull request changes `packages/review/`: the live run and the
delta.** The job runs the thirty reviews for real, then compares the result
against `.github/regression-score.json` — the score this repository recorded
for the reviewer as it stands, against that same pinned corpus commit — and
prints a table of metric, recorded, now, delta, and whether the gate still
holds. A gated metric that no longer meets its threshold fails the job, naming
it. The delta is in the job log either way, so the summary the section above
asks you to put in your pull-request body is a number you can copy rather than
one you have to produce by hand.

You do not have to open the log to read it. The gated rows are rendered as a
table on the run's own summary page — metric, `n`, recorded, now, movement and
whether the gate is met — and the run's output directory is attached to the run
as the `regression-run` artifact: the summary the delta read, the per-review
records under it, and the reviews themselves. When a metric moved, that artifact
is how you get at the review that moved it without paying for the run again.

That run costs about fifteen dollars, on the maintainer's key, so two things
have to be true before it starts: the job has an `ANTHROPIC_API_KEY` secret,
and the pull request actually touches the reviewer. **A pull request from a
fork is not given the secret**, so it gets the dry run, the delta step does not
run, and nothing is spent. That is deliberate rather than a limitation — you do
not need a maintainer's key to open a pull request here. Run the suite on your
own key if you have one and quote it; otherwise say so, and a maintainer will
run it on the branch before merging.

**Re-recording the score.** The recorded score is a fact about one reviewer
against one corpus commit, so it goes stale the moment either moves. A
maintainer re-records it by running the suite on the merged reviewer and
replacing the file:

```bash
node packages/evaluation/dist/main.js prepare --suite regression --corpus <corpus>/fixtures
node packages/evaluation/dist/main.js --suite regression --corpus <corpus>/fixtures \
  --run --repeats 1 --out <out>
node .github/scripts/regression-delta.mjs <out> --record > .github/regression-score.json
```

`--record` writes every metric row's public name, value, `n`, threshold and
whether it is met, and a row per fixture — its id, its class, whether the run
caught it, what the review cost and whether the harness cut it short — read from
`<out>/runs.json`, which is why it takes the whole output directory and refuses
one with no `runs.json` in it. What it cannot know it leaves null: fill in the
corpus commit, the reviewer's model and provider, the date and the run's own
measured total cost by hand. The `_comment` in the file says what each field is.
Bump `.github/corpus-pin.json` in the same commit if the corpus moved too — a
score recorded against one commit and compared against another is not a
comparison. A maintainer can also trigger the workflow by hand
(`workflow_dispatch`) to take the live run without opening a pull request.

## The rest of the bar

- **A test that reads a machine-local scratch directory is a test CI will
  fail.** Floor an assertion on what is always present.
- **Run the new variant; do not read it.** Adding a case to shared machinery
  means every place that branches on the discriminator has to be found, and
  reading the code finds most of them. An end-to-end test per variant is what
  catches the rest.
- **Ask whether a check can come out either way.** A check nobody can fail is
  indistinguishable from a check that works right up until it matters.
- **A corpus fixture is never weakened because the reviewer missed it.** A
  missed fixture is a result.
- **Nothing the model returns becomes an action parameter.** No branch name,
  path, command or pull-request target comes from model output. The reviewer has
  no process-execution surface at all except two named provider transports, and
  the runner and the workspace pass argv, never a shell string.

## Maintainer-only scripts

`pnpm issues:dry-run` and `pnpm issues:apply` reconcile `backlog/issues.json` against the GitHub issues of whichever repository the checkout's `origin` remote names — in a fork, that is your fork, and `issues:apply` would open an issue there for every backlog entry. They are a maintainer's tools for keeping one repository's issues in step with the backlog, not part of the contribution workflow above.

## Licence

Apache-2.0; see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). By signing off a
commit you submit your contribution under that licence.
