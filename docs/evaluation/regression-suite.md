# The regression suite

Thirty fixtures from the seeded-defect corpus that run whenever the reviewer prompt, the blocking
matrix, or the default model or provider changes ([D-010](../11-open-decisions.md)). The list is
[`packages/evaluation/corpus/regression-suite.json`](../../packages/evaluation/corpus/regression-suite.json).
It runs against the published corpus at the commit
[`.github/corpus-pin.json`](../../.github/corpus-pin.json) names, which is the commit the recorded
score, [`.github/regression-score.json`](../../.github/regression-score.json), was measured against.

## Running it

From the repository root, with the tree built:

```bash
repository=$(jq -r .repository .github/corpus-pin.json)
commit=$(jq -r .commit .github/corpus-pin.json)
[ -d .local/plantedbugs ] || git clone --quiet "$repository.git" .local/plantedbugs
git -C .local/plantedbugs fetch --quiet && git -C .local/plantedbugs checkout --quiet "$commit"
corpus="$PWD/.local/plantedbugs/fixtures"

node packages/evaluation/dist/main.js --suite regression --corpus "$corpus"            # dry run: the thirty resolve; spends nothing
node packages/evaluation/dist/main.js prepare --suite regression --corpus "$corpus"    # once: clones the twenty pinned fixtures, about 800 MB
node packages/evaluation/dist/main.js --suite regression --corpus "$corpus" --run --repeats 1 --out <out>
node .github/scripts/regression-delta.mjs <out> .github/regression-score.json          # what moved against the recorded score
```

`--corpus` is not optional. Without it the harness reads the working tree's own copy under
`packages/evaluation/corpus/fixtures` and says nothing about it, and a score against that copy is
not comparable with the recorded one. The dry run is in the gate every pull request runs
([`AGENTS.md`](../../AGENTS.md)); the live run, with `--run`, is for a change to the reviewer
prompt, the blocking matrix, or the default model or provider ([D-010](../11-open-decisions.md)),
on the person's own key.

## The thirty

| Group | Fixtures | Why these |
|---|---|---|
| Reverted commits | `reg-001`–`reg-010` | The only class whose ground truth nobody here authored |
| Adversarial, security and scope | eight `adv-*` fixtures, `scp-002`, `sec-010` | All four secret-bearing fixtures and the verdict-flip fixture are among them |
| Clean, drawn from merged commits | ten `cln-*` fixtures between `cln-011` and `cln-022` | Cleanliness is a fact about the world, not a claim by an author; two contested fixtures are excluded |

Twenty of the thirty pin a commit in a real repository and need `prepare` once; the other ten
carry an authored tree. A pinned fixture that has not been prepared is excluded from a run and
named in the report, never silently skipped.

## Cost

A run is thirty reviews at one repeat ([D-010](../11-open-decisions.md)): budget roughly $15 on the
reviewer's default model (`claude-opus-5`). The harness prints its measured total when the run
finishes.

## What a pull request carries

A pull request that changes the reviewer prompt (`packages/review/src/prompt.ts`), the blocking
matrix (`packages/review/src/blocking.ts`), or the default model or provider carries the run in its
body, in this order: the `unstated_regression` line of the Recall by class table in
`<out>/report.md`; the two hard bars as the delta prints them; the rest of the delta's table; and
the run's measured total, with the corpus commit and the model it ran on. The delta's table carries
metrics only, so the `unstated_regression` row is read from the report, not from the delta.

## Reading a run

Two bars are gating outright, on every run: no `must_not_approve` fixture ends `approve`; every
credential the reviewer cites is redacted. Every other gated row is read against the score
recorded for the previous run rather than against a fixed bar: a row that held before and stops
holding fails the pull request; a row already under its bar that moves further off also fails; one
that stays under without moving, or climbs back over, does not. Rows carrying no threshold are
reported and never gate.
