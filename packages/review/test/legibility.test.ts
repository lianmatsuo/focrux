import { describe, expect, it } from "vitest";
import { assessLegibility } from "../src/legibility.js";

/**
 * The case this exists for, observed on 2026-08-30 (SCP-114).
 *
 * An executor fixing a timing attack wrote U+0000 into a string literal where
 * it meant a space. The code works — a NUL is a valid JavaScript string
 * character — so the pinned checks passed, the scope computation found nothing
 * out of bounds, and the closure verification confirmed the finding addressed.
 * Git classifies a file containing a NUL as binary, so the security-critical
 * function rendered as `Binary files ... differ` and was invisible in the
 * change set, while its 149 lines of tests were visible and green.
 *
 * Three controls approved a change nobody could read, because none of them
 * asked whether it was legible.
 */

const NUL = String.fromCharCode(0);

const diffWith = (path: string, body: string) =>
  `diff --git a/${path} b/${path}\n` +
  `new file mode 100644\n` +
  `--- /dev/null\n` +
  `+++ b/${path}\n` +
  `@@ -0,0 +1,2 @@\n` +
  body
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n") +
  "\n";

const binaryDiff = (path: string) =>
  `diff --git a/${path} b/${path}\n` +
  `new file mode 100644\n` +
  `index 0000000..cd5282d\n` +
  `Binary files /dev/null and b/${path} differ\n`;

describe("a change set the reviewer cannot read (SCP-114)", () => {
  it("blocks on a source file git renders as binary", () => {
    const result = assessLegibility(binaryDiff("packages/webhooks/src/timing-safe-equal.ts"), []);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.blocking).toBe(true);
    expect(finding.routing).toBe("blocks");
    expect(finding.file).toBe("packages/webhooks/src/timing-safe-equal.ts");
    expect(result.check.status).toBe("failed");
  });

  it("blocks on a NUL byte in added source, and names where it is", () => {
    const result = assessLegibility(
      diffWith("src/verify.ts", `const probe = actual.length === 0 ? "${NUL}" : actual;`),
      [],
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.statement).toMatch(/NUL|U\+0000/);
    expect(result.findings[0]!.statement).toMatch(/line \d+/);
  });

  it("blocks rather than routes, because the executor wrote it unreadably", () => {
    const result = assessLegibility(binaryDiff("src/a.ts"), []);
    expect(result.findings[0]!.routing).toBe("blocks");
    expect(result.findings[0]!.closure).toBeNull();
  });

  it("leaves a declared binary asset alone", () => {
    // An image in a path the contract declares for one is not a legibility fault.
    const result = assessLegibility(binaryDiff("packages/ui/assets/logo.png"), ["packages/ui/assets/**"]);
    expect(result.findings).toEqual([]);
    expect(result.check.status).toBe("passed");
  });

  it("does not fire on ordinary source", () => {
    const result = assessLegibility(
      diffWith("src/ok.ts", 'export const greeting = "hello";'),
      [],
    );
    expect(result.findings).toEqual([]);
    expect(result.check.status).toBe("passed");
  });

  it("passes an empty change set", () => {
    expect(assessLegibility("", []).check.status).toBe("passed");
  });
});

describe("the observed case, end to end", () => {
  it("the real diff from the sec-004 loop run blocks", () => {
    // Verbatim from the sampled run: what git produced for the file the
    // executor wrote a NUL into, and what a reviewer was shown of it.
    const observed = [
      "diff --git a/packages/webhooks/src/timing-safe-equal.ts b/packages/webhooks/src/timing-safe-equal.ts",
      "new file mode 100644",
      "index 0000000..cd5282d",
      "Binary files /dev/null and b/packages/webhooks/src/timing-safe-equal.ts differ",
      "diff --git a/packages/webhooks/test/timing-safe-equal.test.ts b/packages/webhooks/test/timing-safe-equal.test.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/packages/webhooks/test/timing-safe-equal.test.ts",
      "@@ -0,0 +1,1 @@",
      '+import { timingSafeEqual } from "../src/timing-safe-equal.js";',
    ].join("\n");
    const result = assessLegibility(observed, []);
    expect(result.check.status).toBe("failed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.file).toBe("packages/webhooks/src/timing-safe-equal.ts");
    // The visible test file is not itself a fault; only the unreadable source is.
    expect(result.findings[0]!.rule_id).toBe("legibility.unrenderable_file");
  });
});
