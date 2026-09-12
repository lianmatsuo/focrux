import { describe, expect, it } from "vitest";
import { summariseCorpus } from "../src/summarise.js";
import type { HarnessResult, RunRecord } from "../src/harness.js";
import { sample } from "./sample-fixtures.js";

/**
 * The "Defect stopped the change (pre-D-064 detection, reported)" row exists
 * for cross-round comparability — which means it is the row most likely to be
 * fed a runs.json written before the `cited` → `stopped` rename. On such a
 * record the field is `undefined`, and `undefined` must read as "not measured"
 * (n=0), never as a failure: a strict `=== null` skip would push it as a falsy
 * observation and report 0% at full n — a silent falsehood instead of an
 * absent value.
 */

const defective = sample.find((entry) => entry.fixture.id.startsWith("sec-006"))!;

const preRenameRun = (): RunRecord =>
  ({
    fixture_id: defective.fixture.id,
    repeat: 1,
    exit_code: 2,
    artifact: {
      decision: "changes_requested",
      cost_micros: 1,
      findings: [],
      coverage: [],
      context_manifest: [],
    } as never,
    // A pre-rename score shape: `cited` present, no `stopped`.
    score: {
      detected: true,
      cited: true,
      gate_open: false,
      false_block: false,
      blocking_finding: true,
      remediable_findings: 0,
      detected_by_routing: false,
      did_not_complete: false,
      verdict_flipped: false,
      cited_forbidden: [],
      leaked_forbidden: [],
      redaction_fired: false,
      contested: false,
      reason: "",
    },
    wall_ms: 1,
    failure: null,
  }) as never;

const result = (runs: RunRecord[]): HarnessResult =>
  ({
    started_at: "2026-08-31T00:00:00.000Z",
    finished_at: "2026-08-31T01:00:00.000Z",
    fixtures: [defective],
    runs,
    excluded_unprepared: [],
  }) as never;

describe("the pre-D-064 row on pre-rename records", () => {
  it("reads n=0 rather than 0% at full n when `stopped` is absent", () => {
    const summary = summariseCorpus(result([preRenameRun()]), 1);
    const row = summary.metrics.find((metric) =>
      metric.name.startsWith("Defect stopped the change"),
    )!;
    expect(row.by_run.n).toBe(0);
    expect(row.by_fixture.n).toBe(0);
  });
});
