import { describe, expect, it } from "vitest";
import { summariseCorpus } from "../src/summarise.js";
import type { HarnessResult, RunRecord } from "../src/harness.js";
import { sample } from "./sample-fixtures.js";

const cleanFixture = sample.find((entry) => entry.fixture.id.startsWith("cln-002"))!;
const otherClean = sample.find((entry) => entry.fixture.id.startsWith("cln-025"))!;

const run = (
  fixture: typeof cleanFixture,
  routings: string[],
  gateOpen: boolean,
  repeat = 1,
): RunRecord =>
  ({
    fixture_id: fixture.fixture.id,
    repeat,
    exit_code: gateOpen ? 0 : 2,
    artifact: {
      decision: gateOpen ? "approve" : "changes_requested",
      cost_micros: 1,
      findings: routings.map((routing, index) => ({
        key: `k${index}`,
        rule_id: "x.y",
        source: "semantic",
        routing,
        blocking: routing === "blocks",
        criterion_id: null,
        file: null,
        symbol: null,
        statement: "s",
      })),
      coverage: [],
      context_manifest: [],
    } as never,
    score: {
      detected: gateOpen,
      gate_open: gateOpen,
      false_block: !gateOpen,
      blocking_finding: routings.includes("blocks"),
      remediable_findings: routings.filter((r) => r === "remediable").length,
      detected_by_routing: false,
      did_not_complete: false,
      verdict_flipped: false,
      leaked_forbidden: [],
      contested: false,
      reason: "",
    },
    wall_ms: 1,
    failure: null,
  }) as never;

const result = (runs: RunRecord[]): HarnessResult =>
  ({
    started_at: "2026-08-29T00:00:00.000Z",
    finished_at: "2026-08-29T01:00:00.000Z",
    fixtures: [cleanFixture, otherClean],
    runs,
    excluded_unprepared: [],
  }) as never;

describe("D-060's companion number ships with the metric", () => {
  it("counts a clean change as shown-to-a-person when a finding blocks or escalates", () => {
    const summary = summariseCorpus(
      result([run(cleanFixture, ["blocks"], false), run(otherClean, ["escalates"], false)]),
      1,
    );
    expect(summary.routing.clean_shown_to_a_person.by_fixture_any_repeat.point).toBe(1);
    expect(summary.routing.clean_shown_to_a_person.by_run.point).toBe(1);
  });

  it("does not count a change whose findings were all routed or advisory", () => {
    const summary = summariseCorpus(
      result([run(cleanFixture, ["remediable", "advisory"], false), run(otherClean, [], true)]),
      1,
    );
    // Neither surfaced anything a person must look at, even though one closed the gate.
    expect(summary.routing.clean_shown_to_a_person.by_fixture_any_repeat.point).toBe(0);
    expect(summary.routing.clean_shown_to_a_person.by_run.point).toBe(0);
  });

  it("is reported beside the suspended gate row so hiding findings is visible", () => {
    const summary = summariseCorpus(
      result([run(cleanFixture, ["blocks"], false), run(otherClean, ["remediable"], false)]),
      1,
    );
    expect(summary.routing.clean_shown_to_a_person.by_fixture_any_repeat.point).toBeCloseTo(0.5, 5);
    expect(summary.routing.clean_shown_to_a_person.by_run.point).toBeCloseTo(0.5, 5);
  });

  it("uses unique clean changes for the primary companion and retains attempts separately", () => {
    const summary = summariseCorpus(
      result([
        run(cleanFixture, ["blocks"], false, 1),
        run(cleanFixture, [], true, 2),
        run(otherClean, [], true, 1),
      ]),
      2,
    );

    expect(summary.routing.clean_shown_to_a_person.by_fixture_any_repeat.successes).toBe(1);
    expect(summary.routing.clean_shown_to_a_person.by_fixture_any_repeat.n).toBe(2);
    expect(summary.routing.clean_shown_to_a_person.by_run.successes).toBe(1);
    expect(summary.routing.clean_shown_to_a_person.by_run.n).toBe(3);
  });
});
