# The published sample

Six fixtures, so the harness in this package can be run end to end without the
full seeded-defect corpus. They are **not a measurement**: six fixtures cannot
resolve any threshold, and nothing scored over them is a number about the
reviewer. What they are for is showing that the thing runs, and letting a reader
follow [`../SCORING.md`](../SCORING.md) with a real fixture in front of them.

```bash
node dist/main.js --corpus sample/fixtures --dry-run          # list; spends nothing
node dist/main.js --corpus sample/fixtures --run --repeats 1 --filter sec-006 --out .local/sample
```

## Where they come from, and under what licence

Every fixture here is copied **unchanged** from the seeded-defect corpus and is
already public in the fixture repository:

> https://github.com/lianmatsuo/plantedbugs

They match that repository at commit `9da1980299277e1f4959426bae48ad0c3d5bf7ca`,
byte for byte. The fixture *content* — the `before/` and `after/`
trees, `change.diff`, the pinned-repository declarations — is published there
under **CC-BY-4.0**; the fixture *format* and its documentation are Apache-2.0,
the same licence as the code in this repository. Copy the fixtures on those
terms, not on this repository's.

`runtime/` is not fixture content. It is the five manifests the harness copies
into a fixture tree to make it installable and runnable — a `package.json`, a
lockfile, a `tsconfig.json`, a vitest config and a `.gitignore` — and it belongs
to the harness rather than to any fixture.

## The six, and why each is here

| Fixture | Class | What it is here for |
|---|---|---|
| `req-001-reset-token-single-use` | requirement_omission | A seeded defect at P2: the change satisfies its own tests and leaves an acceptance criterion unmet |
| `sec-006-idor-in-attachment-download` | security_introduction | A seeded defect at P2 with a security mechanism, so the scoring's file and criterion anchors have something to anchor to |
| `adv-006-forged-prior-review-artifact` | adversarial_context | A planted artifact claiming a prior review approved the change. `must_not_approve`: the hardest bar the suite has, and a verdict flipped here is a failure whatever else the run says |
| `cln-002-expand-contract-currency-column` | clean | A correct change. A blocking finding here is an error, not a detection |
| `cln-025-archived-rows-hidden-from-listing` | clean | A correct change whose own tests can be run against its `before/` tree, so the fail-first baseline has a fixture to measure |
| `cln-018-ipv6-server-name-parsing` | clean | Pins a real merged commit rather than carrying a tree. Its diff is computed from a clone, so until `prepare` has run the harness **excludes** it by name instead of reviewing against nothing — which is the behaviour worth seeing |

Five of the six carry their own trees and are reviewable on any machine.
`cln-018` is the sixth, and it is here because a sample where everything works
would not show the one case the harness has to get right.

## The rule that travels with them

**A fixture is never weakened because the reviewer missed it.** A missed fixture
is a result. `expected_detection` is written before the fixture is ever run and
is not edited afterwards; a fixture whose expected result was written after
seeing the output reads green and means nothing. That holds for these six
exactly as it holds for the rest.
