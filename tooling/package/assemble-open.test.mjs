// The properties of assemble-open.mjs a reader has to be able to check without
// running an assembly: the private set is absent from the plan, the guard fires
// on the three things that are actually private, and a Markdown link into the
// private set is flattened or its table row dropped rather than published as a
// 404. The control plane filter gets the same treatment: the section and the
// milestone it holds are absent from a plan run over planted content, and a
// Markdown link into a decision it dropped is flattened the same way a link
// into the private set is. This suite also spawns the script's own
// `--self-test` and `--dry-run` over the real, committed tree, and assembles
// that tree once and runs its validators inside it, so the checks CI depends
// on are exercised here and not only when somebody remembers to run the flags
// by hand.
//
//   node --test tooling/package/assemble-open.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assembleOpenGuard,
  BACKLOG,
  CONTROL_PLANE_SECTION_HEADING,
  controlPlaneGuard,
  decisionAnchor,
  DECISION_REGISTER,
  ensureGitRepo,
  filterControlPlaneBacklog,
  filterControlPlaneRegister,
  isPrivate,
  memorySource,
  plan,
  PRIVATE_PATHS,
  privateNameGuard,
  quotations,
  resolveMarkdownLinks,
} from "./assemble-open.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "assemble-open.mjs");
const ROOT = join(HERE, "..", "..");
const CLI_PACKAGE = "apps/cli";

/** One in-memory file, in the shape the guard consumes. */
function file(to, text) {
  return { to, bytes: Buffer.from(text, "utf8") };
}

// ---------------------------------------------------------------------------
// The private set
// ---------------------------------------------------------------------------

/** One file planted at each private path pattern, and the public files beside them. */
const PLANTED_TREE = {
  "tooling/package/private-names.json": '{"names":[]}\n',
  ".focrux/config.json": "{}\n",
  ".focrux/principles.md": "# Principles\n",
  ".focrux/tickets/FCX-1.json": '{"id":"FCX-1"}\n',
  ".focrux/tickets/FCX-1.contract.json": "{}\n",
  ".focrux/tickets/sequence.json": "{}\n",
  "docs/00-product-thesis.md": "# The thesis\n",
  "docs/20-customer-revenue-and-fundraising.md": "# Revenue\n",
  "docs/design/Main.dc.html": "<main></main>\n",
  "docs/design/README.md": "# Design\n",
  "docs/design/list-json.md": "# list --json\n",
  "docs/design/prototypes/planning.html": "<p></p>\n",
  "docs/adr/0001-planted.md": "# ADR-0001\n",
  "docs/adr/0003-planted.md": "# ADR-0003\n",
  "docs/adr/0006-planted.md": "# ADR-0006\n",
  "docs/adr/0008-planted.md": "# ADR-0008\n",
  "docs/adr/0009-planted.md": "# ADR-0009\n",
  "docs/adr/0012-planted.md": "# ADR-0012\n",
  "docs/adr/0021-planted.md": "# ADR-0021\n",
  "docs/adr/0029-planted.md": "# ADR-0029\n",
  "docs/evaluation/README.md": "# Evaluation\n",
  "docs/evaluation/desktop-asset-identity.json": "{}\n",
  "docs/evaluation/regression-suite.md": "# The regression suite\n",
  "docs/evaluation/spend.md": "# The ledger\n",
  "docs/evaluation/stage-9-planted-preregistration.md": "# A registration\n",
  "docs/evaluation/stage-9-planted-result.md": "# A result\n",
  "docs/reviews/planted-critique.md": "# A critique\n",
  "docs/vision/focrux-boundaries.html": "<html></html>\n",
  "packages/review/src/blocking.ts": "export const x = 1;\n",
  "tooling/capture/capture.mjs": "export const x = 1;\n",
};

test("every private path pattern is planted, and the plan refuses each one", () => {
  // One file per rule, so a rule that stopped matching fails here rather than
  // publishing what it was written to hold back.
  const carried = new Set(plan(memorySource(PLANTED_TREE)).entries.map(({ to }) => to));
  for (const rule of PRIVATE_PATHS) {
    const planted = Object.keys(PLANTED_TREE).filter((path) => isPrivate(path) && carried.has(path) === false);
    assert.ok(
      planted.some((path) => path.startsWith(rule.glob.replace(/\*+.*$/, ""))),
      `nothing is planted at ${rule.glob}, so this suite does not check that rule`,
    );
  }
  for (const path of Object.keys(PLANTED_TREE)) {
    assert.equal(carried.has(path), !isPrivate(path), `${path} travelled: ${carried.has(path)}`);
  }
});

test("the ticket store's config travels and its records do not", () => {
  const { entries, excluded } = plan(memorySource(PLANTED_TREE));
  const carried = entries.map(({ to }) => to);
  assert.ok(carried.includes(".focrux/config.json"));
  assert.ok(carried.includes(".focrux/principles.md"));
  assert.deepEqual(carried.filter((path) => path.startsWith(".focrux/tickets/")), []);
  assert.equal(excluded.filter((row) => row.glob === ".focrux/tickets/**").length, 3);
});

test("a method document under docs/evaluation travels and a dated record does not", () => {
  const carried = new Set(plan(memorySource(PLANTED_TREE)).entries.map(({ to }) => to));
  assert.ok(!carried.has("docs/evaluation/README.md"));
  assert.ok(carried.has("docs/evaluation/regression-suite.md"));
  assert.ok(!carried.has("docs/evaluation/spend.md"));
  assert.ok(!carried.has("docs/evaluation/stage-9-planted-result.md"));
  assert.ok(!carried.has("docs/evaluation/desktop-asset-identity.json"));
});

test("the hosted plane's ADRs stay private, and their index rows go with them", () => {
  const tree = {
    ...PLANTED_TREE,
    "docs/adr/0006-entitlements-metering.md": "# ADR-0006: Entitlements\n",
    "docs/adr/0035-rename-the-product-to-focrux.md": "# ADR-0035: Rename\n",
    "docs/adr/README.md":
      "| ADR | Title |\n|---|---|\n" +
      "| [0006](0006-entitlements-metering.md) | entitlements and metering |\n" +
      "| [0035](0035-rename-the-product-to-focrux.md) | the rename |\n",
  };
  const { entries } = plan(memorySource(tree));
  const carried = new Set(entries.map(({ to }) => to));
  assert.ok(!carried.has("docs/adr/0006-entitlements-metering.md"));
  assert.ok(carried.has("docs/adr/0035-rename-the-product-to-focrux.md"));
  const index = resolveMarkdownLinks(entries.filter(({ to }) => to.endsWith(".md")).map(({ to, from }) => ({ to, bytes: Buffer.from(tree[from ?? to] ?? "", "utf8") })));
  const text = index.files.find(({ to }) => to === "docs/adr/README.md").bytes.toString("utf8");
  assert.doesNotMatch(text, /entitlements/);
  assert.match(text, /the rename/);
});

test("under docs/design only list-json.md travels; the index and the boards do not", () => {
  const carried = new Set(plan(memorySource(PLANTED_TREE)).entries.map(({ to }) => to));
  assert.ok(carried.has("docs/design/list-json.md"));
  assert.ok(!carried.has("docs/design/README.md"));
  assert.ok(!carried.has("docs/design/Main.dc.html"));
  assert.ok(!carried.has("docs/design/prototypes/planning.html"));
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

test("a .local/ run directory in the front door is refused, naming the file", () => {
  assert.throws(
    () => assembleOpenGuard([file("README.md", "The run is under `.local/round-seven/`.\n")]),
    (error) => {
      assert.match(error.message, /README\.md/);
      assert.match(error.message, /a \.local\/ run directory/);
      return true;
    },
  );
});

test("an evidence-archive name in the front door is refused", () => {
  assert.throws(
    () => assembleOpenGuard([file("NOTICE", "Checked against SHA256SUMS.\n")]),
    /an evidence-archive name/,
  );
});

test("a path into the private set in the front door is refused", () => {
  assert.throws(
    () => assembleOpenGuard([file("README.md", "Scored in docs/evaluation/stage-1-result.md.\n")]),
    /a path into the private set/,
  );
});

test("the evaluation directory itself, and a method document in it, are not paths into the private set", () => {
  assert.doesNotThrow(() =>
    assembleOpenGuard([
      file("README.md", "The method documents are under docs/evaluation, and the suite is docs/evaluation/regression-suite.md.\n"),
    ]),
  );
});

test("the same reference is a citation everywhere but the front door", () => {
  // The record is kept in the archive and its name is how it is asked for; a
  // comment that says which run measured a number is worth more than one that
  // hides it.
  assert.doesNotThrow(() =>
    assembleOpenGuard([
      file(
        "packages/review/src/blocking.ts",
        "// Measured in docs/evaluation/stage-2-human-agreement-result.md, under `.local/round-two/`.\n",
      ),
    ]),
  );
});

test("this repository's own identifiers are refused nowhere", () => {
  // SCP-nnn, D-0nn, ADR-nnnn and docs/NN name documents in the same tree.
  assert.doesNotThrow(() =>
    assembleOpenGuard([
      file("README.md", "SCP-094, D-010, ADR-0023 and docs/04 are all here.\n"),
      file("packages/review/src/blocking.ts", "// SCP-094 counts a clean change as carrying no blocking finding.\n"),
    ]),
  );
});

// ---------------------------------------------------------------------------
// The private names
// ---------------------------------------------------------------------------

// The guard takes its names as an argument, so these tests name nobody real.
// The list the repository actually uses is private, and this file is carried
// into the public tree: a test that spelled out what the guard refuses would
// publish it just as surely as the leak the guard exists to stop.
const NAMES = [
  { pattern: /widgets[\s]*-[\s]*internal/gi, what: "the private repository" },
  { pattern: /acme[\s._-]*holdings/gi, what: "a client" },
];

test("the private repository is refused whether or not the name is a link", () => {
  for (const [form, text] of [
    ["a link", "File a problem at https://github.com/someone/widgets-internal/issues/new.\n"],
    ["a bare owner/repository", "python3 scripts/sync.py --repo someone/widgets-internal\n"],
    ["an SSH remote", "git clone git@github.com:someone/widgets-internal.git\n"],
    ["an issue reference", 'parseIssueReference("someone/widgets-internal#193")\n'],
    ["the name alone, without its owner", "cd ~/code/widgets-internal\n"],
    ["a name a document wrapped across a line", "the repository widgets-\ninternal holds it\n"],
  ]) {
    assert.throws(
      () => privateNameGuard([file("README.md", text)], NAMES),
      (error) => {
        assert.match(error.message, /README\.md:1/);
        assert.match(error.message, /private repository/);
        return true;
      },
      form,
    );
  }
});

test("a client's name is refused however it is spaced, punctuated and cased", () => {
  for (const name of ["acmeholdings", "ACME Holdings", "Acme-Holdings", "acme_holdings"]) {
    assert.throws(
      () => privateNameGuard([file("apps/desktop/src/renderer/preview.ts", `  owner: "${name}",\n`)], NAMES),
      (error) => {
        assert.match(error.message, /preview\.ts:1/);
        assert.match(error.message, /client/);
        return true;
      },
      name,
    );
  }
});

test("a private name in a file's path is refused, not only in its text", () => {
  assert.throws(
    () => privateNameGuard([file("docs/widgets-internal-notes.md", "Nothing to see.\n")], NAMES),
    (error) => {
      assert.match(error.message, /in the path/);
      return true;
    },
  );
});

test("a file naming nobody private is not refused", () => {
  assert.doesNotThrow(() =>
    privateNameGuard(
      [file("README.md", "File a problem at https://github.com/lianmatsuo/focrux/issues/new.\n")],
      NAMES,
    ),
  );
});

test("a file that cannot be read as text is reported rather than searched", () => {
  const unread = privateNameGuard([file("docs/diagram.png", "\u0000PNG payload\n")], NAMES);
  assert.deepEqual(unread, ["docs/diagram.png"]);
});

test("privateNameGuard names every offending file and line, not only the first", () => {
  assert.throws(
    () =>
      privateNameGuard(
        [
          file("README.md", "https://github.com/someone/widgets-internal#readme\n"),
          file(
            "apps/desktop/src/shared/protocol.ts",
            '  problem: "https://github.com/someone/widgets-internal/issues/new",\n',
          ),
        ],
        NAMES,
      ),
    (error) => {
      assert.match(error.message, /README\.md:1/);
      assert.match(error.message, /apps\/desktop\/src\/shared\/protocol\.ts:1/);
      return true;
    },
  );
});

test("a dangling relative link fails the assembly, naming the file and the link", () => {
  const doc = file("packages/runner/README.md", "Derived from [the table](../../docs/08-absent.md).\n");
  assert.throws(
    () => resolveMarkdownLinks([doc], []),
    (error) => {
      assert.match(error.message, /packages\/runner\/README\.md/);
      assert.match(error.message, /\.\.\/\.\.\/docs\/08-absent\.md/);
      return true;
    },
  );
});

test("a link into the private set is flattened to its own text, target and all", () => {
  const doc = file(
    "packages/review/PROMPTS.md",
    "Scored in [`stage-1-result.md`](../../docs/evaluation/stage-1-result.md).\n",
  );
  const { files, flattened } = resolveMarkdownLinks([doc], []);
  assert.equal(files[0].bytes.toString("utf8"), "Scored in `stage-1-result.md`.\n");
  assert.deepEqual(flattened, [{ to: "packages/review/PROMPTS.md", count: 1 }]);
});

test("a relative link the tree does carry travels unchanged", () => {
  const readme = file("packages/review/README.md", "The prompts are in [PROMPTS.md](PROMPTS.md).\n");
  const prompts = file("packages/review/PROMPTS.md", "# Prompts\n");
  const { files, flattened } = resolveMarkdownLinks([readme, prompts], []);
  assert.equal(files[0].bytes.toString("utf8"), readme.bytes.toString("utf8"));
  assert.deepEqual(flattened, []);
});

test("a table row whose every link is private is dropped, and a mixed row keeps its public link", () => {
  const index = file(
    "docs/README.md",
    "| | |\n|---|---|\n" +
      "| [`20-revenue`](20-customer-revenue-and-fundraising.md) | Revenue |\n" +
      "| [`adr/`](adr/README.md), [`vision/`](vision/README.md) | Records |\n" +
      "| No link at all | A row of prose |\n",
  );
  const adr = file("docs/adr/README.md", "# ADRs\n");
  const { files, dropped, flattened } = resolveMarkdownLinks([index, adr], []);
  const text = files[0].bytes.toString("utf8");
  assert.ok(!text.includes("20-customer-revenue-and-fundraising.md"));
  assert.ok(text.includes("[`adr/`](adr/README.md)"));
  assert.ok(!text.includes("(vision/README.md)"));
  assert.ok(text.includes("No link at all"));
  assert.deepEqual(dropped, [{ to: "docs/README.md", count: 1 }]);
  assert.deepEqual(flattened, [{ to: "docs/README.md", count: 1 }]);
});

test("the vendored upstream skills are carried byte for byte, illustrative links and all", () => {
  const skill = file(
    "tooling/skills/mattpocock/domain-modeling/CONTEXT-FORMAT.md",
    "See [./src/ordering/CONTEXT.md](./src/ordering/CONTEXT.md).\n",
  );
  const { files, flattened } = resolveMarkdownLinks([skill], []);
  assert.equal(files[0].bytes.toString("utf8"), skill.bytes.toString("utf8"));
  assert.deepEqual(flattened, []);
});

// ---------------------------------------------------------------------------
// The control plane filter
//
// The hosted control plane's design arrives on main as one section of the
// decision register (`## The control plane`, holding its own D-nnn entries)
// and one milestone of the backlog (`Control plane`). Neither exists on this
// branch, so every row here plants its own — the filter has to work whether
// or not the tree it runs over carries one yet.
// ---------------------------------------------------------------------------

/** A register with one public decision, a control plane section of two, and a following public section. */
const PLANTED_REGISTER =
  "# Decision register\n\n" +
  "## The product\n\n" +
  "### D-001 — Focrux is public\n\n" +
  "- Owner: Founder\n" +
  "- Decision: it ships.\n\n" +
  "## The control plane\n\n" +
  "### D-905 — Team memory is hosted\n\n" +
  "- Owner: Founder\n" +
  "- Decision: memory is hosted.\n\n" +
  "### D-907 — SSO is hosted\n\n" +
  "- Owner: Founder\n" +
  "- Decision: SSO is hosted.\n\n" +
  "## Work and planning\n\n" +
  "### D-002 — Work is admitted one ticket at a time\n\n" +
  "- Owner: Founder\n" +
  "- Decision: one ticket at a time.\n";

/** A backlog with public entries, two Control plane entries and the milestone's own definition. */
function plantedBacklog(overrides = {}) {
  const feature = (id, milestone, dependsOn = []) => ({
    id,
    title: `Entry ${id}`,
    milestone,
    labels: ["type:feature"],
    outcome: "An outcome.",
    acceptance_criteria: ["A criterion."],
    depends_on: dependsOn,
  });
  return {
    version: 4,
    generated_at: "2026-09-11",
    milestones: [
      { title: "Release", description: "The public release." },
      { title: "Control plane", description: "The hosted control plane." },
    ],
    labels: [{ name: "type:feature", color: "0E8A16", description: "Product or platform capability" }],
    issues: [feature("SCP-001", "Release"), feature("SCP-900", "Control plane"), feature("SCP-901", "Control plane")],
    ...overrides,
  };
}

test("the control plane section and its decisions are filtered from the register; the next section is intact", () => {
  const { text, droppedIds, droppedAnchors } = filterControlPlaneRegister(PLANTED_REGISTER);
  assert.ok(!text.includes(CONTROL_PLANE_SECTION_HEADING));
  assert.ok(!text.includes("D-905"));
  assert.ok(!text.includes("D-907"));
  assert.deepEqual(droppedIds, ["D-905", "D-907"]);
  assert.deepEqual(
    [...droppedAnchors].sort(),
    [decisionAnchor("D-905 — Team memory is hosted"), decisionAnchor("D-907 — SSO is hosted")].sort(),
  );
  // The following section, and the public decision before the dropped one,
  // both survive untouched.
  assert.match(text, /## Work and planning/);
  assert.match(text, /### D-002 — Work is admitted one ticket at a time/);
  assert.match(text, /### D-001 — Focrux is public/);
});

test("a register whose control plane section runs to the end of the file loses only that section", () => {
  const noFollowingSection = PLANTED_REGISTER.slice(0, PLANTED_REGISTER.indexOf("## Work and planning"));
  const { text, droppedIds } = filterControlPlaneRegister(noFollowingSection);
  assert.ok(!text.includes(CONTROL_PLANE_SECTION_HEADING));
  assert.deepEqual(droppedIds, ["D-905", "D-907"]);
  assert.match(text, /### D-001 — Focrux is public/);
});

test("a register with no control plane section is returned unchanged", () => {
  const withoutSection = PLANTED_REGISTER.replace(
    /## The control plane\n\n### D-905[\s\S]*?### D-907 — SSO is hosted\n\n- Owner: Founder\n- Decision: SSO is hosted\.\n\n/,
    "",
  );
  assert.ok(!withoutSection.includes(CONTROL_PLANE_SECTION_HEADING));
  const { text, droppedIds, droppedAnchors } = filterControlPlaneRegister(withoutSection);
  assert.equal(text, withoutSection);
  assert.deepEqual(droppedIds, []);
  assert.equal(droppedAnchors.size, 0);
});

test("the Control plane backlog entries and milestone are filtered; the public entry is intact", () => {
  const { text, droppedIds, droppedMilestone } = filterControlPlaneBacklog(JSON.stringify(plantedBacklog()));
  // The output keeps 2-space indent and key order, the source's own
  // formatting, so a diff against it reads cleanly.
  assert.match(text, /^\{\n  "version": 4,\n/);
  const data = JSON.parse(text);
  assert.deepEqual(droppedIds, ["SCP-900", "SCP-901"]);
  assert.ok(droppedMilestone);
  assert.deepEqual(data.issues.map((issue) => issue.id), ["SCP-001"]);
  assert.deepEqual(data.milestones.map((milestone) => milestone.title), ["Release"]);
});

test("the milestone filter matches \"Control Plane\" regardless of case", () => {
  const mixedCaseBacklog = plantedBacklog({
    milestones: [
      { title: "Release", description: "The public release." },
      { title: "Control Plane", description: "The hosted control plane." },
    ],
    issues: [
      { ...plantedBacklog().issues[0] },
      { ...plantedBacklog().issues[1], milestone: "Control Plane" },
      { ...plantedBacklog().issues[2], milestone: "CONTROL PLANE" },
    ],
  });
  const { droppedIds, droppedMilestone } = filterControlPlaneBacklog(JSON.stringify(mixedCaseBacklog));
  assert.deepEqual(droppedIds, ["SCP-900", "SCP-901"]);
  assert.ok(droppedMilestone);
});

test("a link to a dropped decision's anchor is flattened, while a link to a public decision's anchor is kept", () => {
  const { text: filteredRegisterText, droppedAnchors } = filterControlPlaneRegister(PLANTED_REGISTER);
  const register = file(DECISION_REGISTER, filteredRegisterText);
  const droppedAnchor = decisionAnchor("D-905 — Team memory is hosted");
  const publicAnchor = decisionAnchor("D-001 — Focrux is public");
  const doc = file(
    "packages/review/PROMPTS.md",
    `Filed under [D-905](../../${DECISION_REGISTER}#${droppedAnchor}) and ` +
      `[D-001](../../${DECISION_REGISTER}#${publicAnchor}).\n`,
  );
  const { files, flattened } = resolveMarkdownLinks([doc, register], [], droppedAnchors);
  const text = files[0].bytes.toString("utf8");
  assert.equal(text, "Filed under D-905 and [D-001](../../docs/11-open-decisions.md#d-001--focrux-is-public).\n");
  assert.deepEqual(flattened, [{ to: "packages/review/PROMPTS.md", count: 1 }]);
});

test("a table row whose only link is a dropped decision's anchor is dropped, the same as a private link", () => {
  const { text: filteredRegisterText, droppedAnchors } = filterControlPlaneRegister(PLANTED_REGISTER);
  const register = file(DECISION_REGISTER, filteredRegisterText);
  const droppedAnchor = decisionAnchor("D-905 — Team memory is hosted");
  const publicAnchor = decisionAnchor("D-001 — Focrux is public");
  const index = file(
    "docs/README.md",
    "| | |\n|---|---|\n" +
      `| [D-905](11-open-decisions.md#${droppedAnchor}) | Hosted |\n` +
      `| [D-001](11-open-decisions.md#${publicAnchor}) | Public |\n`,
  );
  const { files, dropped, flattened } = resolveMarkdownLinks([index, register], [], droppedAnchors);
  const text = files[0].bytes.toString("utf8");
  assert.ok(!text.includes("Hosted"));
  assert.ok(text.includes("[D-001](11-open-decisions.md#d-001--focrux-is-public)"));
  assert.deepEqual(dropped, [{ to: "docs/README.md", count: 1 }]);
  assert.deepEqual(flattened, []);
});

test("a public backlog entry depending on a dropped Control plane entry refuses, naming both", () => {
  const withDependency = plantedBacklog({
    issues: [
      { ...plantedBacklog().issues[0], depends_on: ["SCP-900"] },
      ...plantedBacklog().issues.slice(1),
    ],
  });
  assert.throws(
    () => filterControlPlaneBacklog(JSON.stringify(withDependency)),
    (error) => {
      assert.match(error.message, /SCP-001/);
      assert.match(error.message, /SCP-900/);
      return true;
    },
  );
});

test("controlPlaneGuard refuses when the register still carries the control plane section", () => {
  assert.throws(
    () => controlPlaneGuard([file(DECISION_REGISTER, PLANTED_REGISTER)]),
    (error) => {
      assert.match(error.message, /still carries a/);
      assert.match(error.message, /The control plane/);
      return true;
    },
  );
});

test("controlPlaneGuard refuses when the backlog still carries a Control plane entry or the milestone", () => {
  assert.throws(
    () => controlPlaneGuard([file(BACKLOG, JSON.stringify(plantedBacklog()))]),
    /Control plane/,
  );
  const milestoneOnly = plantedBacklog({ issues: [plantedBacklog().issues[0]] });
  assert.throws(() => controlPlaneGuard([file(BACKLOG, JSON.stringify(milestoneOnly))]), /Control plane/);
});

test("controlPlaneGuard refuses a surviving entry or milestone whose case differs from \"Control plane\"", () => {
  const differentCaseEntry = plantedBacklog({
    milestones: [{ title: "Release", description: "The public release." }],
    issues: [plantedBacklog().issues[0], { ...plantedBacklog().issues[1], milestone: "Control Plane" }],
  });
  assert.throws(() => controlPlaneGuard([file(BACKLOG, JSON.stringify(differentCaseEntry))]), /Control plane/);

  const differentCaseMilestone = plantedBacklog({
    milestones: [
      { title: "Release", description: "The public release." },
      { title: "control plane", description: "The hosted control plane." },
    ],
    issues: [plantedBacklog().issues[0]],
  });
  assert.throws(() => controlPlaneGuard([file(BACKLOG, JSON.stringify(differentCaseMilestone))]), /Control plane/);
});

test("controlPlaneGuard passes filtered content — the guard that the filter ran, not that it never runs", () => {
  const filteredRegister = filterControlPlaneRegister(PLANTED_REGISTER);
  const filteredBacklog = filterControlPlaneBacklog(JSON.stringify(plantedBacklog()));
  assert.doesNotThrow(() =>
    controlPlaneGuard(
      [file(DECISION_REGISTER, filteredRegister.text), file(BACKLOG, filteredBacklog.text)],
      { droppedDecisionIds: filteredRegister.droppedIds },
    ),
  );
});

// ---------------------------------------------------------------------------
// Labels only the Control plane entries use
// ---------------------------------------------------------------------------

test("a label used only by dropped Control plane entries is filtered; a label a public entry also uses, and an unused label, both stay", () => {
  const backlog = {
    version: 4,
    generated_at: "2026-09-11",
    milestones: [
      { title: "Release", description: "The public release." },
      { title: "Control plane", description: "The hosted control plane." },
    ],
    labels: [
      { name: "type:feature", color: "0E8A16", description: "Product or platform capability" },
      { name: "area:commercial", color: "5319E7", description: "Hosted plane commercial work" },
      { name: "status:done", color: "cccccc", description: "Closed" },
    ],
    issues: [
      {
        id: "SCP-001",
        title: "Public",
        milestone: "Release",
        labels: ["type:feature"],
        outcome: "x",
        acceptance_criteria: ["x"],
        depends_on: [],
      },
      {
        id: "SCP-900",
        title: "Hosted",
        milestone: "Control plane",
        labels: ["type:feature", "area:commercial"],
        outcome: "x",
        acceptance_criteria: ["x"],
        depends_on: [],
      },
    ],
  };
  const { text, droppedLabels } = filterControlPlaneBacklog(JSON.stringify(backlog));
  const data = JSON.parse(text);
  assert.deepEqual(droppedLabels, ["area:commercial"]);
  const names = data.labels.map((label) => label.name);
  assert.ok(names.includes("type:feature"), "a label a remaining public entry also uses stays");
  assert.ok(names.includes("status:done"), "a label nobody used at all stays");
  assert.ok(!names.includes("area:commercial"), "a label used only by the dropped entry is filtered");
});

test("controlPlaneGuard refuses a backlog that still declares a label used only by a dropped Control plane entry", () => {
  // The Control plane entry itself is already gone here — otherwise the
  // earlier "still carries an entry with milestone" check would fire first —
  // so this isolates the label check the way the milestone tests above
  // isolate theirs.
  const survivor = JSON.stringify({
    labels: [
      { name: "type:feature", color: "0E8A16", description: "x" },
      { name: "area:commercial", color: "5319E7", description: "y" },
    ],
    issues: [{ id: "SCP-001", milestone: "Release", labels: ["type:feature"], depends_on: [] }],
    milestones: [{ title: "Release", description: "x" }],
  });
  assert.throws(
    () => controlPlaneGuard([file(BACKLOG, survivor)], { droppedLabels: ["area:commercial"] }),
    /area:commercial/,
  );
});

// ---------------------------------------------------------------------------
// Private ids cited in public text
// ---------------------------------------------------------------------------

test("controlPlaneGuard refuses a public file citing a dropped decision id and a dropped backlog id, naming file and line", () => {
  const filteredRegister = filterControlPlaneRegister(PLANTED_REGISTER);
  const filteredBacklog = filterControlPlaneBacklog(JSON.stringify(plantedBacklog()));
  const citing = file(
    "packages/review/src/blocking.ts",
    "// Background.\n// See D-905 for the free tier and SCP-900 for the hosted work.\n",
  );
  assert.throws(
    () =>
      controlPlaneGuard(
        [file(DECISION_REGISTER, filteredRegister.text), file(BACKLOG, filteredBacklog.text), citing],
        { droppedDecisionIds: filteredRegister.droppedIds, droppedBacklogIds: filteredBacklog.droppedIds },
      ),
    (error) => {
      assert.match(error.message, /packages\/review\/src\/blocking\.ts:2/);
      assert.match(error.message, /D-905/);
      assert.match(error.message, /SCP-900/);
      return true;
    },
  );
});

test("a file on the private-id exemption list citing a dropped id is not refused", () => {
  const filteredRegister = filterControlPlaneRegister(PLANTED_REGISTER);
  const citing = file("tooling/package/assemble-open.test.mjs", "// D-905 is planted as a numbering fixture.\n");
  assert.doesNotThrow(() =>
    controlPlaneGuard(
      [citing],
      { droppedDecisionIds: filteredRegister.droppedIds },
      [{ glob: "tooling/package/assemble-open.test.mjs", reason: "this suite's own planted fixtures" }],
    ),
  );
});

// ---------------------------------------------------------------------------
// The script itself, over the real tree
// ---------------------------------------------------------------------------

/**
 * Runs assemble-open.mjs itself and returns {status, stdout, stderr} instead
 * of throwing on a non-zero exit.
 */
function runAssembleOpen(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

// ---------------------------------------------------------------------------
// --verify runs the assembled tree's own gate as the repository it becomes
// ---------------------------------------------------------------------------

/**
 * `--verify` installs and runs the assembled tree's gate inside the target,
 * and the public repository will be one commit of that tree — so a test that
 * reads git (`git ls-files`, a commit-sha check) fails in a bare directory
 * with "not a git repository". `ensureGitRepo` is what makes the target one
 * before the gate runs; these two rows are it, without paying for a real
 * `pnpm install` and a real gate.
 */
test("ensureGitRepo makes a plain directory a git repository with one commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "focrux-assemble-open-git-"));
  try {
    writeFileSync(join(dir, "file.txt"), "hello\n");
    assert.throws(
      () => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { stdio: "pipe" }),
      "expected a plain directory to hold no commit yet",
    );

    ensureGitRepo(dir);

    const sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.match(sha, /^[0-9a-f]{40}$/);
    const log = execFileSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" }).trim().split("\n");
    assert.equal(log.length, 1, "expected exactly one commit");
    const tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" }).trim();
    assert.equal(tracked, "file.txt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureGitRepo leaves a directory that is already a git repository alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "focrux-assemble-open-git-existing-"));
  try {
    execFileSync("git", ["init", "-b", "main", dir], { stdio: "pipe" });
    writeFileSync(join(dir, "file.txt"), "hello\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "pipe" });
    execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-C", dir, "commit", "-m", "existing"],
      {
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Someone",
          GIT_AUTHOR_EMAIL: "someone@example.com",
          GIT_COMMITTER_NAME: "Someone",
          GIT_COMMITTER_EMAIL: "someone@example.com",
        },
      },
    );
    const before = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    ensureGitRepo(dir);

    const after = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(after, before, "ensureGitRepo must not touch a directory that is already a git repository");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Four tests below assemble this repository's own committed tree, which only the
// repository that holds the private name list can do: the guard reads that list,
// and it is in the private set. In the published tree the file is absent by
// design, so they say why they are skipped rather than failing there. Everything
// else in this suite runs in both trees.
const ASSEMBLES_A_PUBLIC_TREE = existsSync(new URL("./private-names.json", import.meta.url));
const whereItAssembles = ASSEMBLES_A_PUBLIC_TREE
  ? {}
  : { skip: "no private name list here: this is the published tree, not the one it is published from" };

test("`--self-test` over the real, committed tree passes every row", whereItAssembles, () => {
  const result = runAssembleOpen(["--self-test"]);
  assert.equal(result.status, 0, result.stderr);
  // Not just the exit code: a row that stopped being planted at all would
  // still exit zero on the remaining rows, so assert no row printed FAIL and
  // that the tally it ends on counts every row as passing.
  assert.doesNotMatch(result.stdout, /^FAIL/m);
  const tally = /^(\d+)\/(\d+) rows pass$/m.exec(result.stdout);
  assert.ok(tally, `--self-test printed no row tally:\n${result.stdout}`);
  assert.equal(tally[1], tally[2]);
  assert.ok(Number(tally[2]) > 0, "--self-test ran no rows");
});

test("`--dry-run` over the real, committed tree refuses nothing", whereItAssembles, (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "focrux-assemble-open-dry-run-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const result = runAssembleOpen([join(scratch, "out"), "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Refusing to assemble/);
  assert.match(result.stdout, /file\(s\) excluded as private:/);
});

test("`--quotations` prints each verbatim founder quotation with its decision", () => {
  const result = runAssembleOpen(["--quotations"]);
  assert.equal(result.status, 0, result.stderr);
  const decisions = [...result.stdout.matchAll(/^(D-\d{3})\s+docs\/11-open-decisions\.md:\d+$/gm)];
  assert.ok(decisions.length > 0, `--quotations found no quotation:\n${result.stdout.slice(0, 400)}`);
  // Read from the register itself rather than from a copy of the count here.
  assert.equal(
    decisions.length + result.stdout.split("\n").filter((line) => /^\(before the first decision\)/.test(line)).length,
    quotations({
      read: (path) => execFileSync("git", ["-C", ROOT, "show", `HEAD:${path}`], { maxBuffer: 32 * 1024 * 1024 }),
    }).length,
  );
});

/** The suite that runs the published README's own quick start, in the tree that publishes it. */
const QUICK_START_TEST = "open-readme-quickstart.test.ts";

test("an assembled tree carries the README it publishes, the suite that runs it, and passes its validators", whereItAssembles, (t) => {
  // A real assembly, so this writes the whole public tree. `t.after` takes it
  // away again however this row ends: a gate that runs on every push should not
  // leave a copy of the tree behind each time.
  const scratch = mkdtempSync(join(tmpdir(), "focrux-assemble-open-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const target = join(scratch, "out");
  const result = runAssembleOpen([target]);
  assert.equal(result.status, 0, result.stderr);

  const carried = join(target, CLI_PACKAGE, "test", QUICK_START_TEST);
  assert.ok(existsSync(carried), `the assembled tree holds no ${CLI_PACKAGE}/test/${QUICK_START_TEST}`);
  assert.match(
    readFileSync(carried, "utf8"),
    /## Quick start/,
    "the assembled copy of the quick-start suite does not read a quick start",
  );

  // What it reads there: the assembled tree's own README.md, holding a quick
  // start with a command in it.
  const quickStart = section(readFileSync(join(target, "README.md"), "utf8"), "## Quick start");
  assert.match(
    quickStart,
    /```bash\n[\s\S]*?node apps\/cli\/dist\/[\w.-]+\.js/,
    "the assembled README's quick start runs no CLI command, so the suite would read nothing there",
  );

  // The ticket store's config travels and its records do not — checked on a
  // tree on disk, not only on a plan.
  assert.ok(existsSync(join(target, ".focrux", "config.json")));
  assert.ok(!existsSync(join(target, ".focrux", "tickets")));
  for (const absent of ["docs/reviews", "docs/design/focrux-v2", "docs/design/renders", "docs/vision", "tooling/capture"]) {
    assert.ok(!existsSync(join(target, absent)), `the assembled tree carries ${absent}`);
  }
  assert.ok(existsSync(join(target, "docs", "design", "list-json.md")));
  assert.ok(!existsSync(join(target, "docs", "evaluation", "README.md")));

  // And the indices inside it hold: the documentation and backlog validators
  // run against the assembled tree, which is where their rows now point.
  for (const validator of ["scripts/validate_backlog.py", "scripts/validate_docs.py"]) {
    execFileSync("python3", [validator], { cwd: target, stdio: "pipe" });
  }
});

test("a register and backlog filtered from planted control plane content still pass the repository's own validators", whereItAssembles, (t) => {
  // A real assembly of the real tree, which carries no control plane content
  // on this branch — so this plants some on the assembled copy, the way
  // pull request #634 will on main, filters it out, and proves the result is
  // still a register and backlog the repository's own gate accepts.
  const scratch = mkdtempSync(join(tmpdir(), "focrux-assemble-open-cp-validate-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const target = join(scratch, "out");
  const result = runAssembleOpen([target]);
  assert.equal(result.status, 0, result.stderr);

  const registerPath = join(target, DECISION_REGISTER);
  const registerWithControlPlane =
    readFileSync(registerPath, "utf8") +
    "\n## The control plane\n\n" +
    "### D-200 — A hosted decision, first\n\n- Owner: Founder\n- Decision: it is hosted.\n\n" +
    "### D-201 — A hosted decision, second\n\n- Owner: Founder\n- Decision: it is hosted too.\n";
  const filteredRegister = filterControlPlaneRegister(registerWithControlPlane);
  assert.deepEqual(filteredRegister.droppedIds, ["D-200", "D-201"]);
  writeFileSync(registerPath, filteredRegister.text);

  const backlogPath = join(target, BACKLOG);
  const backlogWithControlPlane = JSON.parse(readFileSync(backlogPath, "utf8"));
  backlogWithControlPlane.milestones.push({ title: "Control plane", description: "The hosted control plane." });
  backlogWithControlPlane.issues.push(
    {
      id: "SCP-900",
      title: "A hosted entry",
      milestone: "Control plane",
      labels: ["type:feature"],
      outcome: "It is hosted.",
      acceptance_criteria: ["It runs on the hosted plane."],
      depends_on: [],
    },
    {
      id: "SCP-901",
      title: "Another hosted entry",
      milestone: "Control plane",
      labels: ["type:feature"],
      outcome: "It is hosted too.",
      acceptance_criteria: ["It also runs on the hosted plane."],
      depends_on: [],
    },
  );
  const filteredBacklog = filterControlPlaneBacklog(JSON.stringify(backlogWithControlPlane));
  assert.deepEqual(filteredBacklog.droppedIds, ["SCP-900", "SCP-901"]);
  assert.ok(filteredBacklog.droppedMilestone);
  writeFileSync(backlogPath, filteredBacklog.text);

  assert.doesNotThrow(() =>
    controlPlaneGuard(
      [file(DECISION_REGISTER, filteredRegister.text), file(BACKLOG, filteredBacklog.text)],
      { droppedDecisionIds: filteredRegister.droppedIds },
    ),
  );

  for (const validator of ["scripts/validate_backlog.py", "scripts/validate_docs.py"]) {
    execFileSync("python3", [validator], { cwd: target, stdio: "pipe" });
  }
});

// ---------------------------------------------------------------------------
// The README the public tree publishes
// ---------------------------------------------------------------------------

/** The named section of a Markdown document, up to the next `## ` heading or the end of the file. */
function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `no "${heading}" section`);
  const end = text.indexOf("\n## ", start + 1);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

/**
 * Every command `apps/cli/src/main.ts` dispatches, read out of the switch
 * itself rather than from a copy of the list kept here.
 */
function dispatchedCommands(text) {
  const start = text.indexOf("dispatch(");
  assert.notEqual(start, -1, "apps/cli/src/main.ts defines no dispatch(), so this test reads nothing");
  const names = [...text.slice(start).matchAll(/^[ \t]*case\s+"([\w-]+)":/gm)].map((match) => match[1]);
  assert.ok(names.length > 0, "apps/cli/src/main.ts dispatches no command, so this test reads nothing");
  return [...new Set(names)].sort();
}

test("the CLI README's \"The six commands\" table names only commands the entry point actually dispatches", () => {
  // Read from the table rather than from the whole document: apps/cli/README.md
  // is the CLI's own reference, and a backticked word in a later section there
  // is prose, not a claim about what the binary can do. The table names a
  // curated subset — the loop's own six, not the whole command set — so this
  // checks containment, not equality: a command added to the table and not to
  // main.ts's switch, or renamed in one and not the other, fails here.
  const dispatched = dispatchedCommands(readFileSync(join(ROOT, CLI_PACKAGE, "src", "main.ts"), "utf8"));
  const table = section(readFileSync(join(ROOT, CLI_PACKAGE, "README.md"), "utf8"), "## The six commands");
  const named = [...new Set([...table.matchAll(/^\|\s*`([a-z][\w-]*)`\s*\|/gm)].map((match) => match[1]))].sort();
  assert.ok(named.length > 0, "the six-commands table names no command");
  for (const name of named) {
    assert.ok(dispatched.includes(name), `apps/cli/README.md names ${name}, which apps/cli/src/main.ts does not dispatch`);
  }
});

test("the CLI README's \"Quick start\" names the default provider before ANTHROPIC_API_KEY", () => {
  // The readiness run's doctor used --provider claude-cli, the default, with no
  // key set at all. A reader going top to bottom meets the thing the run
  // actually needs (the locally installed `claude`, already signed in) before
  // the one key that serves a provider they are not using by default.
  const running = section(readFileSync(join(ROOT, CLI_PACKAGE, "README.md"), "utf8"), "## Quick start");

  const keyIndex = running.indexOf("ANTHROPIC_API_KEY");
  assert.notEqual(keyIndex, -1, '"Quick start" no longer names ANTHROPIC_API_KEY');
  const providerIndex = running.indexOf("claude-cli");
  assert.notEqual(providerIndex, -1, '"Quick start" no longer names the default provider (claude-cli)');
  assert.ok(
    providerIndex < keyIndex,
    `expected claude-cli named before ANTHROPIC_API_KEY in "Quick start" (claude-cli at ` +
      `${providerIndex}, ANTHROPIC_API_KEY at ${keyIndex})`,
  );

  const flat = running.replace(/\s+/g, " ");
  assert.match(flat, /anthropic[^.]*ANTHROPIC_API_KEY|ANTHROPIC_API_KEY[^.]*anthropic/is);
  assert.match(flat, /codex-cli/);
});

/**
 * The two READMEs a person meets first: the repository's own and the one beside
 * the binary. Each names the section that is its quick start.
 */
const LEAD_READMES = [
  { name: "README.md", path: join(ROOT, "README.md"), quickStart: "## Quick start" },
  { name: `${CLI_PACKAGE}/README.md`, path: join(ROOT, CLI_PACKAGE, "README.md"), quickStart: "## Quick start" },
];

/** The paragraph under a document's first heading — what a reader has read before deciding to go on. */
function leadParagraph(text) {
  const start = text.indexOf("\n\n", text.indexOf("# "));
  assert.notEqual(start, -1, "the document has no paragraph under its first heading");
  const body = text.slice(start + 2);
  return body.slice(0, body.indexOf("\n\n")).replace(/\s+/g, " ");
}

/** Every CLI invocation inside a passage's fenced code blocks, in the order they appear. */
function invocationsInCodeBlocks(text) {
  const found = [];
  for (const block of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    const body = block[1];
    const base = block.index + block[0].indexOf(body);
    const call = /(?:^|[|&]\s*)(?:node\s+[^\s|&]*apps\/cli\/dist\/[\w.-]+\.js|focrux)\s+([a-z][\w-]*)/gm;
    for (const match of body.matchAll(call)) found.push({ name: match[1], index: base + match.index });
  }
  return found;
}

test("both READMEs lead with the loop, and both quick starts open with `run`", () => {
  // The product is the loop — a ticket on your repository taken to a pull
  // request by an executor, an independent reviewer and remediation on the
  // branch. A quick start's first command is what a reader tries first, so it
  // has to be the loop and not a command among the others.
  for (const readme of LEAD_READMES) {
    const text = readFileSync(readme.path, "utf8");

    const lead = leadParagraph(text);
    for (const [what, pattern] of [
      ["the loop", /\bloop\b/i],
      ["the pull request the loop ends at", /pull request/i],
      ["the executor that writes the change", /executor/i],
      ["the reviewer that judges it", /reviewer/i],
      ["what is left for a person", /person/i],
    ]) {
      assert.match(lead, pattern, `${readme.name}'s first paragraph does not name ${what}:\n${lead}`);
    }

    const quickStart = section(text, readme.quickStart);
    const commands = invocationsInCodeBlocks(quickStart);
    assert.ok(commands.length > 0, `${readme.name}'s "${readme.quickStart}" runs no command at all`);
    assert.equal(
      commands[0].name,
      "run",
      `${readme.name}'s "${readme.quickStart}" opens with \`${commands[0].name}\`; the first command a ` +
        "reader is given is the loop",
    );
  }
});

test("the CLI README reaches `review --pr` only after the loop", () => {
  // `review --pr` is the loop's review step run on its own, one command among
  // the others; a reader has to meet the loop's own quick start first. Only
  // apps/cli/README.md documents the command in enough detail to name it —
  // the root README is the customer-facing pitch and does not enumerate
  // individual commands or flags.
  const readme = LEAD_READMES.find((candidate) => candidate.name === `${CLI_PACKAGE}/README.md`);
  const text = readFileSync(readme.path, "utf8");
  const quickStart = section(text, readme.quickStart);
  const commands = invocationsInCodeBlocks(quickStart);
  const loopAt = text.indexOf(quickStart) + commands[0].index;
  const reviewPrAt = text.indexOf("review --pr");
  assert.notEqual(reviewPrAt, -1, `${readme.name} no longer describes \`review --pr\` at all`);
  assert.ok(
    reviewPrAt > loopAt,
    `${readme.name} reaches \`review --pr\` at ${reviewPrAt}, before the loop at ${loopAt}`,
  );
});

// ---------------------------------------------------------------------------
// The carried set, from the working tree
// ---------------------------------------------------------------------------

/**
 * `git ls-files`, tracked plus untracked-but-not-ignored, so `node_modules/`,
 * `dist/` and the rest of `.gitignore` stay out the same way a commit would
 * leave them out — but a file just added and not yet committed is caught. A
 * `Source` for `plan`, over the working tree instead of a commit.
 */
function diskSource(root) {
  const lsFiles = (args) =>
    execFileSync("git", ["-C", root, "ls-files", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  return {
    describe: "the working tree",
    list(path) {
      const spec = path ? ["--", path] : [];
      const tracked = lsFiles(spec).split("\n");
      const untracked = lsFiles(["--others", "--exclude-standard", ...spec]).split("\n");
      return [...new Set([...tracked, ...untracked].filter((line) => line !== ""))].sort();
    },
    read(path) {
      return readFileSync(join(root, path));
    },
  };
}

/** Every relative specifier a file names in a real `import`/`export ... from` statement. */
function relativeImportSpecifiers(text) {
  const specifiers = new Set();
  for (const match of text.matchAll(/^[ \t]*(?:import|export)\b/gm)) {
    const start = match.index;
    const semicolon = text.indexOf(";", start);
    const statement = text.slice(start, semicolon === -1 ? text.length : semicolon + 1);
    const from = /\bfrom\s+["'](\.[^"']*)["']/.exec(statement);
    if (from) {
      specifiers.add(from[1]);
      continue;
    }
    const bare = /^[ \t]*import\s*["'](\.[^"']*)["']/.exec(statement);
    if (bare) specifiers.add(bare[1]);
  }
  return [...specifiers];
}

/** `specifier` resolved from `fromPath`, with a `.js` specifier mapped to the `.ts` source it names. */
function resolveRelativeImport(fromPath, specifier) {
  const joined = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const candidates = /\.[cm]?js$/.test(joined)
    ? [joined.replace(/\.([cm]?)js$/, ".$1ts"), joined.replace(/\.[cm]?js$/, ".tsx"), joined]
    : [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}.js`, `${joined}/index.ts`, `${joined}/index.js`];
  return candidates.find((candidate) => existsSync(join(ROOT, candidate))) ?? candidates[0];
}

test("every published test file's relative imports resolve inside the carried set", () => {
  // The carried set comes from the assembler's own plan rather than a second
  // copy of which paths are published.
  const { entries } = plan(diskSource(ROOT));
  const carried = new Set(entries.map((entry) => entry.to));
  const testFiles = entries.filter(
    (entry) => /^(?:packages|apps)\/[^/]+\/test\//.test(entry.to) && /\.[cm]?[jt]sx?$/.test(entry.to),
  );
  assert.ok(testFiles.length > 0, "expected at least one published test file to check");

  const offences = [];
  for (const entry of testFiles) {
    const text = readFileSync(join(ROOT, entry.to), "utf8");
    for (const specifier of relativeImportSpecifiers(text)) {
      const resolved = resolveRelativeImport(entry.to, specifier);
      if (!carried.has(resolved)) {
        offences.push(
          `${entry.to}: ${JSON.stringify(specifier)} resolves to ${resolved}, which the assembly does not carry`,
        );
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    `${offences.length} published test file import(s) resolve outside the carried set:\n  ${offences.join("\n  ")}`,
  );
});
