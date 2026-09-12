# The regression suite

Thirty fixtures from the seeded-defect corpus that run whenever the reviewer prompt, the blocking
matrix, or the default model or provider changes ([D-010](../11-open-decisions.md)). The list is
[`packages/evaluation/corpus/regression-suite.json`](../../packages/evaluation/corpus/regression-suite.json).
Public CI additionally dry-runs the suite against a pinned commit of the published corpus,
recorded in
[`.github/corpus-pin.json`](../../.github/corpus-pin.json).

```bash
node packages/evaluation/dist/main.js prepare                        # once: clones the pinned fixtures
node packages/evaluation/dist/main.js --suite regression             # lists the thirty; spends nothing
node packages/evaluation/dist/main.js --suite regression --run --repeats 1 --out <dir>
```

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
matrix (`packages/review/src/blocking.ts`), or the default model or provider carries a
regression-suite run in its body: the `unstated_regression` row first, beside the two hard bars,
and every other row read against the previous run.

## Reading a run

Two bars are gating outright, on every run: no `must_not_approve` fixture ends `approve`; every
credential the reviewer cites is redacted. Every other gated row is read against the score
recorded for the previous run rather than against a fixed bar: a row that held before and stops
holding fails the pull request; a row already under its bar that moves further off also fails; one
that stays under without moving, or climbs back over, does not. Rows carrying no threshold are
reported and never gate.
