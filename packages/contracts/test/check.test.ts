import { describe, expect, it } from "vitest";
import { CheckResultSchema } from "../src/check.js";

/** A check record as written before the re-run fields existed. */
const OLDER_RECORD = {
  check_id: "check_unit",
  name: "unit",
  kind: "unit",
  status: "failed",
  summary: "run failed: command exited (1)",
  command: "pnpm exec turbo run test",
  detail: "ERROR run failed: command exited (1)",
  duration_ms: 1200,
  source: "file",
};

describe("the check record's re-run fields", () => {
  it("leaves an older record parseable and its new fields absent", () => {
    const parsed = CheckResultSchema.parse(OLDER_RECORD);
    expect(parsed.failing_tests).toBeUndefined();
    expect(parsed.reruns).toBeUndefined();
    expect(parsed.flaky).toBeUndefined();
    expect(parsed.rerun).toBeUndefined();
  });

  it("carries the failing tests, the re-run count and the flake", () => {
    const parsed = CheckResultSchema.parse({
      ...OLDER_RECORD,
      status: "passed",
      failing_tests: ["apps/cli/test/x.test.ts > suite > case"],
      reruns: 1,
      flaky: true,
      rerun: {
        command: "pnpm exec vitest run test/x.test.ts",
        scope: "files",
        note: null,
        status: "passed",
        summary: "Tests  143 passed (143)",
        failing_tests: [],
        duration_ms: 900,
      },
    });
    expect(parsed.failing_tests).toEqual(["apps/cli/test/x.test.ts > suite > case"]);
    expect(parsed.reruns).toBe(1);
    expect(parsed.flaky).toBe(true);
    expect(parsed.rerun?.scope).toBe("files");
    expect(parsed.rerun?.status).toBe("passed");
  });

  it("keeps both runs' failing tests when the failure reproduced", () => {
    const parsed = CheckResultSchema.parse({
      ...OLDER_RECORD,
      failing_tests: ["apps/cli/test/x.test.ts > suite > case"],
      reruns: 1,
      flaky: false,
      rerun: {
        command: "pnpm exec turbo run test",
        scope: "task",
        note: "no failing test names were parsed from the check's output",
        status: "failed",
        summary: "Tests  1 failed | 142 passed (143)",
        failing_tests: ["apps/cli/test/x.test.ts > suite > case"],
        duration_ms: 900,
      },
    });
    expect(parsed.status).toBe("failed");
    expect(parsed.rerun?.failing_tests).toEqual(parsed.failing_tests);
    expect(parsed.rerun?.note).toContain("no failing test names");
  });
});

describe("the temporary directory a check ran under", () => {
  it("is absent on a record written before the field existed", () => {
    expect(CheckResultSchema.parse(OLDER_RECORD).tmpdir).toBeUndefined();
  });

  it("carries the directory, and null when the runner had none to give", () => {
    expect(CheckResultSchema.parse({ ...OLDER_RECORD, tmpdir: "/var/folders/9k/T" }).tmpdir).toBe(
      "/var/folders/9k/T",
    );
    expect(CheckResultSchema.parse({ ...OLDER_RECORD, tmpdir: null }).tmpdir).toBeNull();
  });
});
