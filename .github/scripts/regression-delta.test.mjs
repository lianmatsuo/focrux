// regression-delta.mjs against hand-written result files, spawned exactly as
// the workflow spawns it, so what these tests prove is what a pull request's CI
// run actually does.
//
//   node --test .github/scripts/regression-delta.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fixtureRows, publicMetricName, readResult, readRuns } from "./regression-delta.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "regression-delta.mjs");

/**
 * A recorded-score row. `n` is the fixture count the value was measured over.
 * `definition` is SCP-225's `"mechanism"` / `"anchor-OR"` tag; omitted (the
 * default), a row reads exactly as it did before that change.
 */
function row(name, value, n, threshold = null, direction = null, definition = null) {
  return { name, value, n, threshold, direction, definition, meets: gateOf(value, n, threshold, direction) };
}

function gateOf(value, n, threshold, direction) {
  if (threshold === null || direction === null || n === 0) return null;
  return direction === "at_least" ? value >= threshold : value <= threshold;
}

/** The two gated rows every fixture below carries, plus one ungated one. */
function score(overrides = {}) {
  return {
    recorded_at: "2026-09-04",
    corpus: { repository: "https://github.com/lianmatsuo/plantedbugs", commit: "a".repeat(40) },
    reviewer: { model: "claude-opus-5", provider: "claude-cli" },
    suite: "regression",
    repeats: 1,
    total_cost_usd: 12.5,
    metrics: [
      row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least"),
      row("Blocking-defect recall, P2", 0.9, 10, 0.8, "at_least"),
      row("Defect stopped the change (pre-D-064 detection, reported)", 0.7, 20),
    ],
    ...overrides,
  };
}

/** The harness's own summary.json shape, which is what CI hands the script as "now". */
function summary(rows, per_fixture = []) {
  return {
    started_at: "2026-09-04T00:00:00.000Z",
    finished_at: "2026-09-04T00:30:00.000Z",
    repeats: 1,
    not_a_measurement: null,
    per_fixture,
    metrics: rows.map(({ name, value, n, threshold, direction, meets, definition }) => ({
      name,
      threshold,
      direction,
      by_fixture: { point: value, low: 0, high: 1, n, successes: Math.round(value * n) },
      by_run: { point: value, low: 0, high: 1, n, successes: Math.round(value * n) },
      resolves: null,
      meets,
      // Only present where a row is deliberately tagged: the harness itself
      // never writes the field on a row that is not a recall figure, and a
      // fixture here that omits it should read exactly as it did before
      // SCP-225.
      ...(definition ? { definition } : {}),
    })),
  };
}

function write(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), "ayo-regression-delta-"));
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`);
  return path;
}

/** One review as runs.json holds it: the fixture, the answer scored for it, what it cost. */
function record(fixture_id, caught, { cost = 100_000, partial = null } = {}) {
  return {
    fixture_id,
    repeat: 1,
    exit_code: 0,
    artifact: { cost_micros: cost },
    score: { detected: caught, confirmed_detected: caught },
    wall_ms: 1_000,
    failure: null,
    partial,
  };
}

/** A `--out` directory as the harness leaves it: the summary, and the runs beside it. */
function resultDir(summaryDocument, runs) {
  const dir = mkdtempSync(join(tmpdir(), "ayo-regression-delta-out-"));
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summaryDocument, null, 2)}\n`);
  if (runs !== undefined) writeFileSync(join(dir, "runs.json"), `${JSON.stringify(runs, null, 2)}\n`);
  return dir;
}

/** `--record` over a result directory, parsed. */
function recordScore(directory) {
  return JSON.parse(execFileSync(process.execPath, [SCRIPT, directory, "--record"], { encoding: "utf8" }));
}

/**
 * Runs the script and returns {status, stdout, stderr} instead of throwing on a
 * non-zero exit. `flags` are passed after the two paths, and `env` replaces the
 * environment entirely — so a test that wants `GITHUB_STEP_SUMMARY` unset gets
 * it unset rather than inheriting whatever ran the suite.
 */
function run(fresh, recorded, { flags = [], env = {} } = {}) {
  const options = { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } };
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, fresh, recorded, ...flags], options);
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("a run identical to the recorded score is every delta zero, and exits zero", () => {
  const recorded = score();
  const fresh = write("summary.json", summary(recorded.metrics));
  const result = run(fresh, write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  for (const metric of recorded.metrics) {
    assert.match(result.stdout, new RegExp(escape(publicMetricName(metric.name))));
  }
  // Every delta column reads +0.000 — no row drifted, and none is reported as drift.
  assert.equal(result.stdout.match(/[+-]0\.000/g)?.length, recorded.metrics.length);
  assert.doesNotMatch(result.stdout, /REGRESSED/);
});

// The recorded score is published, so it cannot carry the private tree's
// decision and backlog identifiers; both sides are named the same way so a row
// still joins to itself.
test("a metric name's maintainer note is dropped, and the same name is derived from both sides", () => {
  assert.equal(
    publicMetricName("Clean changes passing the gate (reported; threshold suspended, D-060)"),
    "Clean changes passing the gate",
  );
  assert.equal(
    publicMetricName("Every cited credential was redacted (D-063, gating)"),
    "Every cited credential was redacted",
  );
  assert.equal(
    publicMetricName("Defect stopped the change (pre-D-064 detection, reported)"),
    "Defect stopped the change",
  );
  // A note carrying no identifier is part of the metric's meaning and stays.
  assert.equal(
    publicMetricName("Adversarial fixtures caught despite the injection (reported, not gated)"),
    "Adversarial fixtures caught despite the injection (reported, not gated)",
  );
  assert.equal(publicMetricName("Blocking-defect recall, P1"), "Blocking-defect recall, P1");

  // Distinct rows stay distinct once their notes are gone — the property the
  // join depends on, and the one a new metric could quietly break.
  const names = [
    "Clean changes passing the gate (reported; threshold suspended, D-060)",
    "Clean changes with no blocking finding (SCP-094)",
    "Defect stopped the change (pre-D-064 detection, reported)",
    "Defect surfaced to a person or the loop (D-066: escalations included, reported)",
    "Every cited credential was redacted (D-063, gating)",
    "Credential cited before redaction (D-063, reported)",
  ].map(publicMetricName);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.doesNotMatch(name, /SCP-\d|D-0\d|ADR-\d/);
});

test("a P1 recall drop below its threshold exits one, naming the metric", () => {
  const recorded = score();
  const dropped = [
    row("Blocking-defect recall, P1", 0.4, 10, 0.6, "at_least"),
    recorded.metrics[1],
    recorded.metrics[2],
  ];
  const result = run(write("summary.json", summary(dropped)), write("regression-score.json", recorded));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Blocking-defect recall, P1/);
  assert.match(result.stdout + result.stderr, /0\.600/); // the threshold it no longer meets
  // The row that still holds is not named as a regression.
  assert.doesNotMatch(result.stderr, /Blocking-defect recall, P2/);
});

test("a gated metric that fell but still meets its threshold is a delta, not a failure", () => {
  const recorded = score();
  const fell = [row("Blocking-defect recall, P1", 0.7, 10, 0.6, "at_least"), recorded.metrics[1], recorded.metrics[2]];
  const result = run(write("summary.json", summary(fell)), write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /-0\.100/);
});

test("a metric with n 0 on either side is printed as unmeasured and never fails the job", () => {
  const recorded = score({
    metrics: [
      row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least"),
      row("Every cited credential was redacted (D-063, gating)", Number.NaN, 0, 1, "at_least"),
    ],
  });
  const now = [
    row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least"),
    row("Every cited credential was redacted (D-063, gating)", 1, 4, 1, "at_least"),
  ];

  // n = 0 on the recorded side.
  const forward = run(write("summary.json", summary(now)), write("regression-score.json", recorded));
  assert.equal(forward.status, 0, forward.stderr);
  assert.match(forward.stdout, /unmeasured/);

  // n = 0 on the fresh side — the direction that could otherwise read as a
  // collapse to zero and fail a job over a row nobody measured.
  const backward = run(
    write("summary.json", summary(recorded.metrics)),
    write("regression-score.json", score({ metrics: now })),
  );
  assert.equal(backward.status, 0, backward.stderr);
  assert.match(backward.stdout, /unmeasured/);
});

test("a row the recorded score has never seen is printed as new, not as a delta", () => {
  const recorded = score();
  const now = [...recorded.metrics, row("A metric added since the score was recorded", 0.5, 10, 0.4, "at_least")];
  const result = run(write("summary.json", summary(now)), write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not recorded/);
});

test("a run the harness itself refuses to call a measurement fails, whatever its rows say", () => {
  const recorded = score();
  const partial = summary(recorded.metrics);
  partial.not_a_measurement = "the spend ceiling stopped this run after 11 of 30 fixtures";
  const result = run(write("summary.json", partial), write("regression-score.json", recorded));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /spend ceiling/);
});

test("the fresh result may be named as the run's output directory", () => {
  const recorded = score();
  const dir = mkdtempSync(join(tmpdir(), "ayo-regression-delta-out-"));
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary(recorded.metrics), null, 2)}\n`);

  const result = run(dir, write("regression-score.json", recorded));
  assert.equal(result.status, 0, result.stderr);
});

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("--record prints the score file's rows from a run, under the same public names", () => {
  const recorded = score();
  const fresh = resultDir(summary(recorded.metrics), [record("reg-001", true)]);
  const printed = recordScore(fresh);

  assert.deepEqual(
    printed.metrics.map((metric) => metric.name),
    recorded.metrics.map((metric) => publicMetricName(metric.name)),
  );
  assert.equal(printed.metrics[0].value, 0.8);
  assert.equal(printed.metrics[0].meets, true);
  // Nothing the run did not state is invented: the operator fills these in.
  assert.equal(printed.corpus.commit, null);
  assert.equal(printed.total_cost_usd, null);

  // And what it prints is something the delta can read back as a recorded score.
  const round_trip = run(fresh, write("regression-score.json", { ...printed, recorded_at: "2026-09-04" }));
  assert.equal(round_trip.status, 0, round_trip.stderr);
  assert.equal(round_trip.stdout.match(/[+-]0\.000/g)?.length, recorded.metrics.length);
});

// The recorded score is a measurement, not a wish: a suite of thirty fixtures
// reads some corpus thresholds at an n that does not reach them, and those rows
// are recorded as they came out. A gate that was already below its threshold
// when the score was recorded therefore cannot "still" hold, and treating it as
// a failure would fail every pull request from the first one onwards. What the
// job asks is whether this change made things worse.
test("a gate already below its threshold in the recorded score is reported, not failed", () => {
  const recorded = score({
    metrics: [row("Blocking-defect recall, P1", 0.4, 5, 0.6, "at_least")],
  });
  const unchanged = [row("Blocking-defect recall, P1", 0.4, 5, 0.6, "at_least")];
  const result = run(write("summary.json", summary(unchanged)), write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /below threshold/);
});

test("a gate already below its threshold that falls further exits one", () => {
  const recorded = score({
    metrics: [row("Blocking-defect recall, P1", 0.4, 5, 0.6, "at_least")],
  });
  const worse = [row("Blocking-defect recall, P1", 0.2, 5, 0.6, "at_least")];
  const result = run(write("summary.json", summary(worse)), write("regression-score.json", recorded));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Blocking-defect recall, P1/);
});

test("a gate already below its threshold that comes back above it is reported as recovered", () => {
  const recorded = score({
    metrics: [row("Blocking-defect recall, P1", 0.4, 5, 0.6, "at_least")],
  });
  const better = [row("Blocking-defect recall, P1", 0.8, 5, 0.6, "at_least")];
  const result = run(write("summary.json", summary(better)), write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recovered/);
});

// An at_most metric is worse when it goes up, and the direction has to come
// from the row rather than from which way the number moved.
test("a ceiling metric that rises past its threshold exits one", () => {
  const recorded = score({ metrics: [row("A ceiling metric", 0.1, 10, 0.25, "at_most")] });
  const risen = [row("A ceiling metric", 0.4, 10, 0.25, "at_most")];
  const result = run(write("summary.json", summary(risen)), write("regression-score.json", recorded));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /A ceiling metric/);
});

// ---------------------------------------------------------------------------
// The rows: one fixture's answer per row, so a regression has a name
// ---------------------------------------------------------------------------

// A metric is a proportion. "P2 recall fell from 0.933 to 0.867" says one of
// fifteen fixtures changed its mind and does not say which, and the fixture is
// the thing a contributor can open and re-run. So the score carries a row per
// review and the delta names the fixtures that moved.
test("--record writes one row per fixture, read from the run beside the summary", () => {
  const metrics = score().metrics;
  const runs = [
    record("reg-001-dropped-null-check", true, { cost: 155_464 }),
    record("cln-011-trim-with-number-modifier", false, { cost: 448_236 }),
    record("sec-010-signing-key-inlined", null, { cost: null, partial: "timeout" }),
  ];
  const printed = recordScore(
    resultDir(
      summary(metrics, [
        { id: "reg-001-dropped-null-check", class: "unstated_regression" },
        { id: "cln-011-trim-with-number-modifier", class: "clean" },
        { id: "sec-010-signing-key-inlined", class: "security_introduction" },
      ]),
      runs,
    ),
  );

  assert.deepEqual(printed.rows, [
    { id: "reg-001-dropped-null-check", class: "unstated_regression", caught: true, cost: 155_464, partial: null },
    { id: "cln-011-trim-with-number-modifier", class: "clean", caught: false, cost: 448_236, partial: null },
    {
      id: "sec-010-signing-key-inlined",
      class: "security_introduction",
      caught: null,
      cost: null,
      partial: "timeout",
    },
  ]);
  // One row per fixture and no more: a row is one fixture's answer at one repeat.
  assert.equal(printed.rows.length, runs.length);
  assert.equal(new Set(printed.rows.map((fixture) => fixture.id)).size, runs.length);
  // The row is the harness's own answer, not a second scoring of the artifact.
  assert.deepEqual(
    printed.rows.map((fixture) => fixture.caught),
    runs.map((entry) => entry.score.confirmed_detected),
  );
});

// A score whose rows were quietly absent would read as thirty fixtures that all
// kept their answer, which is the one reading a regression score must never
// invite. The writer refuses instead, and says what it could not find.
test("--record refuses a result directory with no runs.json, naming what is missing", () => {
  const directory = resultDir(summary(score().metrics));
  let failure;
  try {
    execFileSync(process.execPath, [SCRIPT, directory, "--record"], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, "--record must not print a score for a result with no runs.json");
  assert.equal(failure.status, 2);
  assert.match(failure.stderr, /runs\.json/);
  assert.match(failure.stderr, new RegExp(escape(directory)));
});

test("a fixture whose answer changed is named in the delta, by id and class", () => {
  const rows = [
    { id: "reg-001-dropped-null-check", class: "unstated_regression", caught: true, cost: 155_464, partial: null },
    { id: "cln-011-trim-with-number-modifier", class: "clean", caught: true, cost: 448_236, partial: null },
  ];
  const recorded = score({ rows });
  const now = score({ rows: [{ ...rows[0], caught: false }, rows[1]] });
  const result = run(write("fresh-score.json", now), write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout + result.stderr;
  assert.match(output, /reg-001-dropped-null-check/);
  assert.match(output, /unstated_regression/);
  assert.match(output, /caught -> not caught/);
  // The fixture that kept its answer is not named as having changed.
  assert.doesNotMatch(result.stdout.split("fixtures whose answer changed")[1], /cln-011/);
});

test("a fixture that started being caught is named too, and no fixture moving says so", () => {
  const rows = [{ id: "reg-002-off-by-one", class: "unstated_regression", caught: false, cost: 1, partial: null }];
  const recovered = run(
    write("fresh-score.json", score({ rows: [{ ...rows[0], caught: true }] })),
    write("regression-score.json", score({ rows })),
  );
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /reg-002-off-by-one .*: not caught -> caught/);

  const unchanged = run(
    write("fresh-score.json", score({ rows })),
    write("regression-score.json", score({ rows })),
  );
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /no fixture changed its answer/);
});

// The fixtures are reported beside the metric deltas; what fails the job is
// still a gated metric this change made worse, on exactly the rule it was.
test("naming a changed fixture does not change which runs fail the gate", () => {
  const rows = [{ id: "reg-001-dropped-null-check", class: "unstated_regression", caught: true, cost: 1, partial: null }];
  const recorded = score({ rows });
  const dropped = score({
    rows: [{ ...rows[0], caught: false }],
    metrics: [row("Blocking-defect recall, P1", 0.4, 10, 0.6, "at_least"), ...recorded.metrics.slice(1)],
  });

  const failing = run(write("fresh-score.json", dropped), write("regression-score.json", recorded));
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /Blocking-defect recall, P1/);
  assert.match(failing.stdout, /reg-001-dropped-null-check/);

  // A fixture flipping while every gated metric holds is reported, not failed.
  const held = run(
    write("fresh-score.json", score({ rows: [{ ...rows[0], caught: false }] })),
    write("regression-score.json", recorded),
  );
  assert.equal(held.status, 0, held.stderr);
  assert.match(held.stdout, /reg-001-dropped-null-check/);
});

// An older recorded score carries no rows at all. Refusing it would fail every
// pull request until it is re-recorded, so the delta says why it can name no
// fixture and goes on comparing the metrics.
test("a score with no rows is said to have none, and the metric delta still runs", () => {
  const recorded = score();
  const result = run(write("summary.json", summary(recorded.metrics)), write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /carries no per-fixture rows/);
  assert.match(result.stdout, /the recorded score/);
});

// The committed score's rows are pinned to the run committed beside it, so this
// asserts what the file says against what the writer derives from that run.
// Nothing here calls a model: the run is on disk and the writer only reads it.
test("the committed score's rows are the writer's output over the run beside it", () => {
  const runDirectory = join(HERE, "..", "..", "tooling", "package", "open-ci", "regression-run");
  const committed = JSON.parse(readFileSync(join(HERE, "..", "regression-score.json"), "utf8"));

  const derived = fixtureRows(readResult(runDirectory), readRuns(runDirectory));

  assert.deepEqual(committed.rows, derived);
  assert.equal(committed.rows.length, committed.fixture_count);
  assert.equal(new Set(committed.rows.map((fixture) => fixture.id)).size, committed.fixture_count);
  for (const fixture of committed.rows) {
    assert.deepEqual(Object.keys(fixture), ["id", "class", "caught", "cost", "partial"]);
    assert.equal(typeof fixture.id, "string");
    assert.equal(typeof fixture.class, "string");
    assert.equal(typeof fixture.caught, "boolean");
  }
});

// ---------------------------------------------------------------------------
// --summary: the delta where a contributor sees it
// ---------------------------------------------------------------------------

// The delta is read off a job log today, which means it is read by whoever
// already knows to open one. `--summary` renders the gated rows as a markdown
// table on the run's own summary page, so the table is the first thing a
// contributor sees rather than the last.

/** The recorded score the golden file is pinned against. */
function goldenRecorded() {
  return score({
    metrics: [
      row("Blocking-defect recall, P1", 0.4, 5, 0.6, "at_least"),
      row("Blocking-defect recall, P2", 0.9333333333333333, 15, 0.8, "at_least"),
      row("Verdict not flipped on a verdict-flipping fixture", 1, 8, 1, "at_least"),
      row("Every cited credential was redacted (D-063, gating)", Number.NaN, 0, 1, "at_least"),
      row("Clean changes passing the gate (reported; threshold suspended, D-060)", 0.7, 10),
    ],
  });
}

/**
 * The fresh run the golden file is pinned against: one gate below its threshold
 * and no worse, one that fell and still holds, one this change broke, one
 * nobody measured, one reported row that is not gated at all, and one gated row
 * the recorded score has never seen. Every cell the table can produce, in one
 * run, so the golden pins the rendering rather than one row of it.
 */
function goldenFresh() {
  return [
    row("Blocking-defect recall, P1", 0.4, 5, 0.6, "at_least"),
    row("Blocking-defect recall, P2", 0.8666666666666667, 15, 0.8, "at_least"),
    row("Verdict not flipped on a verdict-flipping fixture", 0.875, 8, 1, "at_least"),
    row("Every cited credential was redacted (D-063, gating)", Number.NaN, 0, 1, "at_least"),
    row("Clean changes passing the gate (reported; threshold suspended, D-060)", 0.7, 10),
    row("A gate recorded after the score was", 0.5, 10, 0.4, "at_least"),
  ];
}

/** A path in a directory of its own, so a test can assert nothing was written to it. */
function summaryPath() {
  return join(mkdtempSync(join(tmpdir(), "ayo-regression-delta-summary-")), "step-summary.md");
}

test("--summary renders the gated metrics as a markdown table, byte for byte", () => {
  // Pinned by a golden file rather than by a handful of regexes: this table is
  // read by people, and a column that quietly loses its heading, its alignment
  // or its em dash is exactly the kind of change no assertion on a substring
  // would catch. Regenerating the golden is the deliberate act of saying the
  // rendering changed.
  const path = summaryPath();
  const result = run(
    write("summary.json", summary(goldenFresh())),
    write("regression-score.json", goldenRecorded()),
    { flags: ["--summary"], env: { GITHUB_STEP_SUMMARY: path } },
  );

  // One gate broke, so the job fails — and the summary is written all the same.
  assert.equal(result.status, 1);
  assert.equal(
    readFileSync(path, "utf8"),
    readFileSync(join(HERE, "regression-delta-summary.golden.md"), "utf8"),
  );
});

test("the table is appended to GITHUB_STEP_SUMMARY, and nothing is written where the variable is unset", () => {
  const recorded = write("regression-score.json", goldenRecorded());
  const fresh = write("summary.json", summary(goldenFresh()));

  // Appended: GitHub's summary file is shared by every step of the job, so a
  // step that truncated it would delete what the steps before it wrote.
  const path = summaryPath();
  writeFileSync(path, "## An earlier step wrote this\n");
  run(fresh, recorded, { flags: ["--summary"], env: { GITHUB_STEP_SUMMARY: path } });
  run(fresh, recorded, { flags: ["--summary"], env: { GITHUB_STEP_SUMMARY: path } });
  const appended = readFileSync(path, "utf8");
  assert.match(appended, /^## An earlier step wrote this\n/);
  assert.equal(appended.match(/^## Regression delta$/gm)?.length, 2);

  // Unset: the delta is printed exactly as it is without the flag, the script
  // succeeds or fails on the gate alone, and no file appears anywhere it might
  // have guessed one belonged.
  const unset = summaryPath();
  const withFlag = run(fresh, recorded, { flags: ["--summary"] });
  const without = run(fresh, recorded);
  assert.equal(withFlag.status, without.status);
  assert.equal(withFlag.stdout, without.stdout);
  assert.equal(existsSync(unset), false);
  assert.deepEqual(readdirSync(dirname(unset)), []);
});

test("a run whose gates all hold is summarised as one, and says so under the table", () => {
  const recorded = goldenRecorded();
  const path = summaryPath();
  const result = run(
    write("summary.json", summary(recorded.metrics)),
    write("regression-score.json", recorded),
    { flags: ["--summary"], env: { GITHUB_STEP_SUMMARY: path } },
  );

  assert.equal(result.status, 0, result.stderr);
  const markdown = readFileSync(path, "utf8");
  assert.match(markdown, /No gated metric is worse than the recorded score\./);
  assert.doesNotMatch(markdown, /moved the wrong way/);
  // The reported row is in the log's table and not in this one: the summary
  // page answers the question that decides the job.
  assert.doesNotMatch(markdown, /Clean changes passing the gate/);
  assert.match(markdown, /\| Blocking-defect recall, P1 \| 5 \| 0\.400 \| 0\.400 \| \+0\.000 \| not met \(>= 0\.600\) \|/);
});

test("a run the harness refuses to call a measurement is never summarised as a pass", () => {
  const recorded = goldenRecorded();
  const partial = summary(recorded.metrics);
  partial.not_a_measurement = "the spend ceiling stopped this run after 11 of 30 fixtures";
  const path = summaryPath();
  const result = run(write("summary.json", partial), write("regression-score.json", recorded), {
    flags: ["--summary"],
    env: { GITHUB_STEP_SUMMARY: path },
  });

  assert.equal(result.status, 1);
  const markdown = readFileSync(path, "utf8");
  assert.match(markdown, /not a measurement/);
  assert.match(markdown, /spend ceiling/);
  assert.doesNotMatch(markdown, /No gated metric is worse/);
});

// ---------------------------------------------------------------------------
// SCP-225: a row carries which of the two recall readings it is, and the
// delta renders the tag beside the row's name — never inside the name it
// joins rows on, which the earlier tests in this file already pin by using
// `row()` with no sixth argument throughout.
// ---------------------------------------------------------------------------

test("the text table renders a row's definition beside its name, from the field", () => {
  const recorded = score({ metrics: [row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least")] });
  const fresh = write(
    "summary.json",
    summary([row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least", "mechanism")]),
  );
  const result = run(fresh, write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Blocking-defect recall, P1 \(mechanism\)/);
});

// The mutant this pins: reading a missing recorded `definition` as
// `"anchor-OR"` instead of `"mechanism"`. `regression-score.json` predates
// SCP-225 and every row in it is missing the field; the fresh run is the
// first one to tag it, and the row is the same measurement either way.
test("a recorded score without the field is read as mechanism", () => {
  const recorded = score({ metrics: [row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least")] });
  assert.equal(recorded.metrics[0].definition, null);
  const fresh = write(
    "summary.json",
    summary([row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least", "mechanism")]),
  );
  const result = run(fresh, write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Blocking-defect recall, P1 \(mechanism\)/);
  assert.doesNotMatch(result.stdout, /\(anchor-OR\)/);
});

// The mutant this pins: deriving the printed tag by pattern-matching `name`
// instead of reading `definition` — which would either fail to tag this row
// (its name carries no internal clue beyond the literal text SCP-225 already
// put there) or, worse, duplicate a tag a name already carries.
test("an anchor-OR row's own name already carries its tag and is never suffixed twice", () => {
  const recorded = score({ metrics: [row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least")] });
  const fresh = write(
    "summary.json",
    summary([
      row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least", "mechanism"),
      row("Blocking-defect recall, P1 (anchor-OR)", 1, 10, null, null, "anchor-OR"),
    ]),
  );
  const result = run(fresh, write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Blocking-defect recall, P1 \(anchor-OR\)/);
  assert.doesNotMatch(result.stdout, /\(anchor-OR\) \(anchor-OR\)/);
});

// The mutant this pins: swapping which row gets which value — the anchor-OR
// row given the mechanism row's number, or the reverse.
test("the mechanism and anchor-OR rows of the same metric keep their own values", () => {
  const recorded = score({ metrics: [row("Blocking-defect recall, P1", 0.6, 10, 0.6, "at_least")] });
  const fresh = write(
    "summary.json",
    summary([
      row("Blocking-defect recall, P1", 0.5, 10, 0.6, "at_least", "mechanism"),
      row("Blocking-defect recall, P1 (anchor-OR)", 1, 10, null, null, "anchor-OR"),
    ]),
  );
  const result = run(fresh, write("regression-score.json", recorded));

  assert.match(result.stdout, /Blocking-defect recall, P1 \(mechanism\).*0\.500/);
  assert.match(result.stdout, /Blocking-defect recall, P1 \(anchor-OR\).*1\.000/);
});

test("--summary renders a gated row's definition in the markdown table too", () => {
  const recorded = score({ metrics: [row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least")] });
  const fresh = write(
    "summary.json",
    summary([row("Blocking-defect recall, P1", 0.8, 10, 0.6, "at_least", "mechanism")]),
  );
  const path = summaryPath();
  const result = run(fresh, write("regression-score.json", recorded), {
    flags: ["--summary"],
    env: { GITHUB_STEP_SUMMARY: path },
  });

  assert.equal(result.status, 0, result.stderr);
  const markdown = readFileSync(path, "utf8");
  assert.match(markdown, /\| Blocking-defect recall, P1 \(mechanism\) \|/);
});

// A row that is not a recall figure carries no `definition` on either side
// and must print exactly as it always has — the golden byte-for-byte test
// above already pins this; this one states the rule directly.
test("a row with no definition on either side renders with no tag at all", () => {
  const recorded = score({
    metrics: [row("Clean changes passing the gate (reported; threshold suspended, D-060)", 0.7, 10)],
  });
  const fresh = write(
    "summary.json",
    summary([row("Clean changes passing the gate (reported; threshold suspended, D-060)", 0.7, 10)]),
  );
  const result = run(fresh, write("regression-score.json", recorded));

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\(mechanism\)|\(anchor-OR\)/);
});
