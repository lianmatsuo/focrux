import { describe, expect, it } from "vitest";
import { summariseCorpus } from "../src/summarise.js";
import type { HarnessResult, RunRecord } from "../src/harness.js";
import { sample } from "./sample-fixtures.js";

/**
 * The D-066 `surfaced` row, pinned the same way stopped-row-compat pins the
 * pre-D-064 row: a runs.json written before the field existed reads as "not
 * measured" (n=0), never as 0% at full n. Today no live path re-reads a stored
 * score object — rescoring calls scoreRun fresh — but that is an invariant,
 * not a fact, which is exactly why the compat behaviour gets a pin.
 */

const defective = sample.find((entry) => entry.fixture.id.startsWith("sec-006"))!;

const preSurfacedRun = (): RunRecord =>
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
    score: {
      detected: true,
      stopped: true,
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
      reason: "x",
    } as never,
    wall_ms: 1,
    failure: null,
  }) as never;

const result = (runs: RunRecord[]): HarnessResult =>
  ({
    started_at: "2026-09-01T00:00:00.000Z",
    finished_at: "2026-09-01T01:00:00.000Z",
    fixtures: [defective],
    runs,
    excluded_unprepared: [],
  }) as never;

describe("the surfaced row on a pre-D-066 record", () => {
  it("reads a missing surfaced field as not measured, never as a zero", () => {
    const summary = summariseCorpus(result([preSurfacedRun()]), 1);
    const row = summary.metrics.find((metric) => metric.name.includes("surfaced"));
    expect(row).toBeDefined();
    expect(row!.by_run.n).toBe(0);
    expect(row!.by_fixture.n).toBe(0);
  });
});
