#!/usr/bin/env node
// Builds the tree the public repository holds, from a named commit of this
// repository into a target directory: every file tracked at that commit except
// the private set below. The sibling of assemble-corpus.mjs, and it reads the
// same way.
//
// Usage:
//   node tooling/package/assemble-open.mjs <target-dir> [--dry-run] [--commit <sha>]
//   node tooling/package/assemble-open.mjs <target-dir> --verify
//   node tooling/package/assemble-open.mjs --self-test
//   node tooling/package/assemble-open.mjs --quotations
//
// The source is a commit, not the working tree, so an assembly is reproducible
// from a sha and an uncommitted edit cannot reach the public repository by
// accident. `--commit` defaults to HEAD.
//
// D-075 opens everything that runs on one machine, and the public repository
// becomes the home repository after the push. So this script no longer names
// what travels — everything does — and names only what does not: PRIVATE_PATHS.
// A file is carried unless a PRIVATE_PATHS rule matches its path, and each rule
// carries the reason it is a rule. The target must not already exist as a
// non-empty directory. `--dry-run` computes and prints the manifest without
// writing anything.
//
// Before writing (or, on a dry run, before printing the manifest), every
// resolved file's content is scanned against INTERNAL_REFERENCE_PATTERNS below.
// Three things are refused, and they are the three that are actually private:
// a `.local/` run directory, an evidence-archive name, and a path reference
// into the private set. This repository's own identifiers — SCP-nnn, D-0nn,
// ADR-nnnn, docs/NN — are public and are not refused anywhere. A hit refuses
// the assembly unless the (published path, pattern) pair is on ALLOWLIST, with
// a reason.
//
// Every Markdown file carries its links with it, and a relative link whose
// target this tree does not hold is a 404 in the public repository. Each one is
// resolved against the published set. A link that resolves travels unchanged. A
// link into the private set is flattened to plain text automatically — the link
// text stays, the target goes, so the document still names its source and
// nobody follows it into nothing — and a table row whose every link points into
// the private set is dropped instead, because a row that is only a link to a
// document that is not here is not a row. Anything else that dangles must be
// listed in MARKDOWN_LINKS with a reason, which flattens it by the same rule;
// an unlisted dangling link fails the assembly, naming the file and the link.
//
// `--verify` proves the assembled tree stands on its own: it installs and runs
// the tree's own gate inside the target. The public repository will be one
// commit of this tree, and the tree's own tests expect to run inside a git
// repository, so `--verify` makes the target one — `git init` and a single
// commit, with a fixed author and date so the run is reproducible — before the
// gate runs, unless the target already is a git repository of its own.
//
// `--quotations` prints every verbatim founder quotation in the decision
// register with its decision id, so they can be read before a push. It reads
// the register and changes nothing.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  console.error(`assemble-open.mjs needs Node 22 or later; this is ${process.version}`);
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------------------------------------------------------------------
// What does not travel
// ---------------------------------------------------------------------------

// The documents under docs/evaluation that are method rather than record: what
// the suite is, what the ceiling is, what the instrument is, and the index over
// the directory. Everything else there is a record of a particular run on a
// particular day — a pre-registration, a result, a shakedown, a correction, a
// sweep, an audit — and those stay in the archive. Named the safe way round: a
// document added here and not listed is private until somebody says otherwise.
const EVALUATION_METHOD = ["docs/evaluation/regression-suite.md"];

// Everything the public tree does not carry, as {glob, reason} rules with an
// optional `except` list. `glob` is matched with matchesGlob below: `*` matches
// within one path segment, `**` across segments.
// The one document under docs/design that is a specification rather than a
// board: the `list --json` contract the code cites. The directory's own index
// (docs/design/README.md) describes only the boards and prototypes that stay
// private, so it stays with them.
const DESIGN_SPECS = ["docs/design/list-json.md"];

// The hosted plane is the commercial product, and its design stays in the archive
// (D-076). These ADRs describe it. They are matched by number, so a retitled file
// is still caught.
const HOSTED_PLANE_ADRS = ["0001", "0003", "0006", "0008", "0009", "0012", "0021", "0029"];

const PRIVATE_PATHS = [
  {
    glob: "tooling/package/private-names.json",
    reason:
      "the names a public tree must not carry. The guard that reads it travels; the list does not, " +
      "because a published list of forbidden names publishes the names.",
  },
  {
    glob: ".focrux/tickets/**",
    reason:
      "the ticket store's own records — every ticket, its contract, its drafts and the sequence. " +
      "`.focrux/config.json` and `.focrux/principles.md` travel; the records do not.",
  },
  {
    glob: "docs/evaluation/**",
    except: EVALUATION_METHOD,
    reason:
      "a dated record of one run: a pre-registration, a result, a shakedown, a remediation brief, " +
      "a correction, a sweep, or the JSON one of them was scored from. The method documents beside " +
      "them travel.",
  },
  {
    glob: "docs/reviews/**",
    reason: "the adversarial review, the product critique and the postmortem: records of this project being read.",
  },
  {
    glob: "docs/vision/**",
    reason: "two dated narrative snapshots of direction, written for the founder rather than for a reader of the code.",
  },
  {
    glob: "docs/design/**",
    except: DESIGN_SPECS,
    reason: "the design artboards, the canvas they seed, their renderings and the prototypes.",
  },
  {
    glob: "docs/20-customer-revenue-and-fundraising.md",
    reason: "customer and revenue intelligence.",
  },
  {
    glob: "tooling/capture/**",
    reason:
      "it exists to render docs/design's artboards and to shoot docs/vision's pages; both are " +
      "private, so the renderer has nothing here to render.",
  },
  ...HOSTED_PLANE_ADRS.map((number) => ({
    glob: `docs/adr/${number}-*.md`,
    reason: "an ADR of the hosted control plane, whose design stays in the archive (D-076).",
  })),
];

/** The rule that keeps `path` out of the public tree, or undefined. */
function privateRule(path) {
  return PRIVATE_PATHS.find(
    (rule) => matchesGlob(rule.glob, path) && !(rule.except ?? []).includes(path),
  );
}

/** Whether the public tree carries `path`. */
function isPrivate(path) {
  return privateRule(path) !== undefined;
}

// A link may name a directory rather than a file (`../vision`). It points into
// the private set when a file under that directory would.
function pointsIntoPrivate(path) {
  return isPrivate(path) || isPrivate(`${path.replace(/\/+$/, "")}/_`);
}

// The first segment of every private rule, for the reference pattern below: a
// string in a published file that starts with one of these and resolves into
// the private set is a path reference into it.
const PRIVATE_ROOTS = [
  ".focrux/tickets",
  "docs/evaluation",
  "docs/reviews",
  "docs/vision",
  "docs/design",
  "docs/20-customer-revenue-and-fundraising.md",
  "tooling/capture",
];

/** `text` with any leading `./` and `../` segments removed. */
function withoutPrefix(text) {
  return text.replace(/^(?:\.{1,2}\/)+/, "");
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

// The documents a person meets first. They have to read on their own, so a
// reference in one of them to something the public tree does not carry is a
// refusal rather than a citation. AGENTS.md is not one of them: it is the
// working-rules file, and it cites this project's own records the way the code
// beside it does.
const FRONT_DOOR = ["README.md", "LICENSE", "NOTICE", "CONTRIBUTING.md"];

// Everything a published file must not carry, as {id, label, pattern} triples
// with an optional `only` list of paths the pattern is applied to and an
// optional `allow` predicate on a single match. `id` keys ALLOWLIST entries;
// `label` is what a refusal names. Every pattern is global so the refusal can
// quote the offending text rather than only its class.
//
// Three, and no more. The identifier families this repository cites —
// SCP-nnn, D-0nn, ADR-nnnn, docs/NN — are public documents in the same tree, so
// nothing refuses them; likewise a hosted endpoint, because there is no hosted
// plane to leak the address of.
//
// All three are scoped to FRONT_DOOR. Everywhere else in the tree, a path that
// names one of this project's own records is a citation: the record is kept in
// the archive, its name is how it is asked for, and a comment that says which
// run measured a number is worth more than one that hides it — the rule the
// identifier citations were already carried under. What holds tree-wide
// instead is the link rule below: a Markdown link into the private set is
// flattened everywhere, so no document ships a link a reader can follow into
// nothing, and an unlisted dangling link refuses the assembly.
const INTERNAL_REFERENCE_PATTERNS = [
  // `.local/` only as a path segment of its own: `printer.local/status` in the
  // egress test is a host name, not this repository's run directory.
  { id: "local-dir", label: "a .local/ run directory", only: FRONT_DOOR, pattern: /(?<![\w.])\.local\//g },
  {
    id: "evidence-archive",
    label: "an evidence-archive name",
    only: FRONT_DOOR,
    pattern: /SHA256SUMS|evidence-archive/gi,
  },
  {
    id: "private-path",
    label: "a path into the private set",
    only: FRONT_DOOR,
    pattern: new RegExp(
      `(?<![\\w./-])(?:\\.{1,2}/)*(?:${PRIVATE_ROOTS.map((root) =>
        root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ).join("|")})(?:/[\\w.@+-]+)*`,
      "g",
    ),
    // A mention of the directory itself — "every document under
    // docs/evaluation" — names nothing the tree does not hold. Only a path that
    // resolves to a file the private set keeps is refused. The sentence's own
    // full stop is not part of the path, so it comes off before the question is
    // asked; `spend.md.` at the end of a sentence is still `spend.md`.
    allow: (match) => !isPrivate(withoutPrefix(match[0]).replace(/\.+$/, "")),
  },
];

// (Published path, pattern id) pairs allowed to carry that reference, each with
// the reason. `path` may be a glob. An entry documents a deliberate, reviewed
// exception; it is not a way to silence the guard by surprise. Empty today: the
// patterns above are scoped to the five documents that must read on their own,
// and none of them carries an exception.
const ALLOWLIST = [];

// Markdown files carried byte for byte, links and all. One entry, and the
// reason is that the bytes are the point: the vendored upstream skills are
// pinned by tooling/skills/build.mjs against their source, so a link rewritten
// here would fail that check — and their links are illustrative paths into an
// imaginary consuming repository rather than references to anything in any
// tree. scripts/validate_docs.py excludes them from its own link check for the
// same reason.
const VERBATIM_MARKDOWN = ["tooling/skills/mattpocock/**"];

// Relative Markdown links whose target this tree does not carry and which the
// private set does not explain, listed per file with the reason, and flattened
// to plain text rather than published as a 404. A link into the private set
// needs no entry: it is flattened by the rule above, which is what the private
// set is for.
const MARKDOWN_LINKS = [
  {
    path: "**/*.md",
    target: "**/.local/**",
    reason: "A run directory is gitignored, so a document that points at one points at nothing in any tree.",
  },
];

// ---------------------------------------------------------------------------
// Reading a commit
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** A source: every read goes through one of these, so --self-test can supply a tree that exists only in memory. */
function commitSource(commit) {
  const sha = git(["rev-parse", "--verify", `${commit}^{commit}`]).trim();
  // The mode bit travels with the file: `scripts/setup-local.mjs` is the
  // documented entry point a person runs as `./scripts/setup-local.mjs`, and a
  // copy written with the default mode is one they cannot.
  const executable = new Set(
    git(["ls-tree", "-r", sha])
      .split("\n")
      .filter((line) => line.startsWith("100755 "))
      .map((line) => line.slice(line.indexOf("\t") + 1)),
  );
  return {
    describe: `commit ${sha}`,
    sha,
    executable,
    list(path) {
      const args = ["ls-tree", "-r", "--name-only", sha];
      if (path) args.push("--", path);
      const out = git(args).trim();
      return out === "" ? [] : out.split("\n");
    },
    read(path) {
      return execFileSync("git", ["-C", ROOT, "show", `${sha}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
    },
    /**
     * Every named path's bytes, in one `git cat-file --batch`.
     *
     * A `git show` per file is a process per file, and this tree is a couple of
     * thousand of them: the batch turns a minute and a half into a second, and
     * the gate runs this on every push. The stream is `<oid> <type> <size>\n`,
     * the bytes, and a newline, once per requested path in the order asked.
     */
    readAll(paths) {
      const blobs = new Map();
      if (paths.length === 0) return blobs;
      const out = execFileSync("git", ["-C", ROOT, "cat-file", "--batch"], {
        input: `${paths.map((path) => `${sha}:${path}`).join("\n")}\n`,
        maxBuffer: 1024 * 1024 * 1024,
      });
      let at = 0;
      for (const path of paths) {
        const newline = out.indexOf(0x0a, at);
        const header = out.toString("utf8", at, newline).split(" ");
        if (header[1] !== "blob") {
          throw new Error(`git cat-file returned ${JSON.stringify(header.join(" "))} for ${path}`);
        }
        const start = newline + 1;
        const size = Number(header[2]);
        blobs.set(path, out.subarray(start, start + size));
        at = start + size + 1;
      }
      return blobs;
    },
  };
}

/** A source backed by a plain object of path -> string, for --self-test. */
function memorySource(files) {
  const paths = Object.keys(files).sort();
  return {
    describe: "an in-memory tree",
    list: (path) => (path ? paths.filter((p) => p === path || p.startsWith(`${path}/`)) : [...paths]),
    read: (path) => Buffer.from(files[path], "utf8"),
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * The published tree as a list of {to, from} descriptors, and what was left
 * behind with the rule that left it.
 */
function plan(source) {
  const entries = [];
  const excluded = [];
  for (const path of source.list("").sort()) {
    const rule = privateRule(path);
    if (rule) excluded.push({ path, glob: rule.glob });
    else entries.push({ to: path, from: path });
  }
  return { entries, excluded };
}

/** Every planned file with its bytes, ready for the guard, the manifest and the write. */
function resolveFiles(source, entries) {
  const wanted = entries.filter((entry) => entry.bytes === undefined).map((entry) => entry.from);
  const blobs = source.readAll?.(wanted);
  return entries.map(({ to, from, bytes }) => ({ to, bytes: bytes ?? blobs?.get(from) ?? source.read(from) }));
}

// ---------------------------------------------------------------------------
// The control plane filter
// ---------------------------------------------------------------------------

// The hosted control plane is the commercial product (D-016), and its design
// stays private (D-076) on the founder's decision of 2026-09-11. The eight
// ADRs that describe it are already excluded above by HOSTED_PLANE_ADRS; the
// rest of its design arrives as one section of the decision register and one
// milestone of the backlog, and this filter removes both before the tree
// ships, the same way PRIVATE_PATHS removes a private path.
const DECISION_REGISTER = "docs/11-open-decisions.md";
const BACKLOG = "backlog/issues.json";
const CONTROL_PLANE_SECTION_HEADING = "## The control plane";
const CONTROL_PLANE_MILESTONE = "Control plane";

/** Whether `value` names the control plane milestone, regardless of case: a filter that only caught the exact
 * casing above would leave "Control Plane" content in the public tree. */
function isControlPlaneMilestone(value) {
  return typeof value === "string" && value.toLowerCase() === CONTROL_PLANE_MILESTONE.toLowerCase();
}

// A numbered decision heading: `### D-nnn — Title`. A placeholder
// (`D-NEW-<label>`) never reaches this filter — scripts/assign_ids.py numbers
// it before merge — so only the numbered form is matched here.
const NUMBERED_DECISION_HEADING = /^ {0,3}###[ \t]+D-(\d{3}) — (.+)$/gm;

/**
 * The GitHub heading anchor for `headingText` (a decision heading's content,
 * without its leading `###`): lowercased, everything but letters, digits,
 * spaces and hyphens dropped, then each space becomes a hyphen. This matches
 * the anchors already hand-written elsewhere in this repository, e.g.
 * `#d-069--a-file-anchor-proves-locus-not-the-seeded-mechanism`.
 */
function decisionAnchor(headingText) {
  return headingText
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
}

/**
 * Drops `## The control plane` through the line before the next `## `
 * section, or the end of the file, from a copy of the decision register.
 * Reports which decisions went with it, by id and by the anchor a Markdown
 * link into one of them would use.
 */
function filterControlPlaneRegister(text) {
  const heading = new RegExp(`^${CONTROL_PLANE_SECTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n?`, "m");
  const start = heading.exec(text);
  if (!start) return { text, droppedIds: [], droppedAnchors: new Set() };
  const afterHeading = start.index + start[0].length;
  const nextSection = /^## /m.exec(text.slice(afterHeading));
  const end = nextSection ? afterHeading + nextSection.index : text.length;

  const droppedIds = [];
  const droppedAnchors = new Set();
  for (const match of text.slice(start.index, end).matchAll(NUMBERED_DECISION_HEADING)) {
    droppedIds.push(`D-${match[1]}`);
    droppedAnchors.add(decisionAnchor(`D-${match[1]} — ${match[2]}`));
  }
  return { text: text.slice(0, start.index) + text.slice(end), droppedIds, droppedAnchors };
}

/**
 * Drops every backlog entry whose milestone is "Control plane", the
 * milestone's own definition, and every declared label that only a dropped
 * entry used — a label a remaining entry also uses, or that no entry uses at
 * all (`status:done` today), is left alone. Refuses, naming them, if a
 * remaining entry depends on one that was dropped, rather than silently
 * editing `depends_on`. Reproduces the source's own indent and key order, so
 * the diff a filtered backlog produces reads cleanly.
 */
function filterControlPlaneBacklog(text) {
  const data = JSON.parse(text);
  const droppedIds = [];
  const labelsOnDropped = new Set();
  const labelsOnKept = new Set();
  if (Array.isArray(data.issues)) {
    data.issues = data.issues.filter((issue) => {
      if (!isControlPlaneMilestone(issue.milestone)) {
        for (const label of issue.labels ?? []) labelsOnKept.add(label);
        return true;
      }
      droppedIds.push(issue.id);
      for (const label of issue.labels ?? []) labelsOnDropped.add(label);
      return false;
    });
  }
  let droppedMilestone = false;
  if (Array.isArray(data.milestones)) {
    data.milestones = data.milestones.filter((milestone) => {
      if (!isControlPlaneMilestone(milestone.title)) return true;
      droppedMilestone = true;
      return false;
    });
  }

  const droppedLabels = [];
  if (Array.isArray(data.labels)) {
    data.labels = data.labels.filter((label) => {
      if (!labelsOnDropped.has(label.name) || labelsOnKept.has(label.name)) return true;
      droppedLabels.push(label.name);
      return false;
    });
  }

  const dropped = new Set(droppedIds);
  const violations = (data.issues ?? [])
    .map((issue) => ({ id: issue.id, on: (issue.depends_on ?? []).filter((dependency) => dropped.has(dependency)) }))
    .filter((row) => row.on.length > 0);
  if (violations.length > 0) {
    throw new Error(
      `Refusing to assemble: ${violations.length} public backlog entr${violations.length === 1 ? "y" : "ies"} ` +
        `depend on a dropped Control plane entry:\n  ` +
        `${violations.map((row) => `${row.id} depends on ${row.on.join(", ")}`).join("\n  ")}`,
    );
  }
  return { text: `${JSON.stringify(data, null, 2)}\n`, droppedIds, droppedMilestone, droppedLabels };
}

/**
 * Runs both control plane filters over the resolved files, replacing the
 * register and the backlog with their filtered copies and leaving every
 * other file untouched.
 */
function filterControlPlane(files) {
  let droppedDecisionIds = [];
  let droppedAnchors = new Set();
  let droppedBacklogIds = [];
  let droppedMilestone = false;
  let droppedLabels = [];
  const next = files.map((file) => {
    if (file.to === DECISION_REGISTER) {
      const result = filterControlPlaneRegister(file.bytes.toString("utf8"));
      droppedDecisionIds = result.droppedIds;
      droppedAnchors = result.droppedAnchors;
      return { ...file, bytes: Buffer.from(result.text, "utf8") };
    }
    if (file.to === BACKLOG) {
      const result = filterControlPlaneBacklog(file.bytes.toString("utf8"));
      droppedBacklogIds = result.droppedIds;
      droppedMilestone = result.droppedMilestone;
      droppedLabels = result.droppedLabels;
      return { ...file, bytes: Buffer.from(result.text, "utf8") };
    }
    return file;
  });
  return { files: next, droppedDecisionIds, droppedAnchors, droppedBacklogIds, droppedMilestone, droppedLabels };
}

/** `\bid\b` for a repository identifier like `D-905` or `SCP-905`: matched whole, never as a substring of a longer id. */
function idBoundaryPattern(id) {
  return new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

// A carried file allowed to cite a private id anyway, as {glob, reason}
// pairs — an entry documents a deliberate, reviewed exception, the same
// contract ALLOWLIST keeps for INTERNAL_REFERENCE_PATTERNS. Limited to test
// code, test fixtures and the desktop's labelled preview sample data: never
// source code, never documentation. Kept as short as the evidence for it.
const PRIVATE_ID_EXEMPTIONS = [];

/**
 * Refuses if control plane content survived the filter above: the guard that
 * it ran, checked on the files that are actually about to ship rather than
 * trusted from the filter's own report. Also refuses a carried file — outside
 * PRIVATE_ID_EXEMPTIONS — that cites, by whole id, a decision or backlog id
 * the filters dropped: on a tree without control-plane content
 * `droppedDecisionIds` and `droppedBacklogIds` are both empty, so this has
 * nothing to look for.
 */
function controlPlaneGuard(
  files,
  { droppedDecisionIds = [], droppedBacklogIds = [], droppedLabels = [] } = {},
  exemptions = PRIVATE_ID_EXEMPTIONS,
) {
  const register = files.find((file) => file.to === DECISION_REGISTER);
  if (register) {
    const text = register.bytes.toString("utf8");
    if (new RegExp(`^${CONTROL_PLANE_SECTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(text)) {
      throw new Error(
        `Refusing to assemble: ${DECISION_REGISTER} still carries a ${JSON.stringify(CONTROL_PLANE_SECTION_HEADING)} heading.`,
      );
    }
    for (const id of droppedDecisionIds) {
      if (new RegExp(`^ {0,3}###[ \t]+${id} — `, "m").test(text)) {
        throw new Error(`Refusing to assemble: ${DECISION_REGISTER} still carries ${id}'s heading.`);
      }
    }
  }
  const backlog = files.find((file) => file.to === BACKLOG);
  if (backlog) {
    const data = JSON.parse(backlog.bytes.toString("utf8"));
    if ((data.issues ?? []).some((issue) => isControlPlaneMilestone(issue.milestone))) {
      throw new Error(
        `Refusing to assemble: ${BACKLOG} still carries an entry with milestone ${JSON.stringify(CONTROL_PLANE_MILESTONE)}.`,
      );
    }
    if ((data.milestones ?? []).some((milestone) => isControlPlaneMilestone(milestone.title))) {
      throw new Error(`Refusing to assemble: ${BACKLOG} still declares the ${JSON.stringify(CONTROL_PLANE_MILESTONE)} milestone.`);
    }
    for (const label of droppedLabels) {
      if ((data.labels ?? []).some((row) => row.name === label)) {
        throw new Error(
          `Refusing to assemble: ${BACKLOG} still declares the label ${JSON.stringify(label)}, used only by a dropped Control plane entry.`,
        );
      }
    }
  }

  const privateIds = [...droppedDecisionIds, ...droppedBacklogIds];
  if (privateIds.length === 0) return;
  const patterns = privateIds.map((id) => ({ id, pattern: idBoundaryPattern(id) }));
  const hits = [];
  for (const { to, bytes } of files) {
    if (bytes.includes(0)) continue; // binary; nothing to read for a citation
    if (exemptions.some((row) => matchesGlob(row.glob, to))) continue;
    const lines = bytes.toString("utf8").split("\n");
    lines.forEach((line, index) => {
      for (const { id, pattern } of patterns) {
        if (pattern.test(line)) hits.push(`${to}:${index + 1}: cites ${id}`);
      }
    });
  }
  if (hits.length > 0) {
    throw new Error(
      `Refusing to assemble: ${hits.length} private id citation(s) in carried file(s):\n  ${hits.join("\n  ")}\n` +
        "Either the citation should not be there, or the file is test code, a test fixture or preview sample " +
        "data and belongs on PRIVATE_ID_EXEMPTIONS with a reason.",
    );
  }
}

// ---------------------------------------------------------------------------
// Markdown links
// ---------------------------------------------------------------------------

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const MARKDOWN_REFERENCE_DEFINITION = /^[ \t]*\[[^\]\n]+\]:[ \t]*(\S+)/gm;

/** A link this script does not resolve: an absolute URL, a protocol-relative one, or a bare anchor. */
function isExternalLink(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#");
}

/** `target`, resolved against the directory `from` sits in, with any anchor dropped. */
function resolveLink(from, target) {
  return posix.normalize(posix.join(posix.dirname(from), target.split("#")[0]));
}

/**
 * Rewrites every copied Markdown file so no relative link dangles.
 *
 * Three outcomes, in order. A table row whose every relative link points into
 * the private set, or into a decision `droppedAnchors` names, is dropped: the
 * row exists to send a reader to a document (or a decision) that is not here,
 * and a row of flattened text sends them nowhere. A link into the private set
 * or a dropped decision's anchor is flattened to its own text. Anything else
 * that does not resolve must be listed in `links`, which flattens it the same
 * way, and an unlisted one refuses the assembly.
 *
 * Returns the files with the rewritten ones replaced, and per-file counts for
 * the manifest — dropping a row and flattening a link are both changes to a
 * published document, so they are reported rather than made quietly.
 */
function resolveMarkdownLinks(files, links = MARKDOWN_LINKS, droppedAnchors = new Set()) {
  // Files and the directories above them, once: a link may name either, and
  // asking "does anything start with this prefix" per link over a tree of a
  // couple of thousand files is quadratic.
  const published = new Set(files.map(({ to }) => to));
  for (const { to } of files) {
    let at = to.lastIndexOf("/");
    while (at > 0) {
      published.add(to.slice(0, at));
      at = to.lastIndexOf("/", at - 1);
    }
  }
  const holds = (path) => published.has(path);

  // A link into docs/11-open-decisions.md whose anchor names a decision the
  // control plane filter dropped: not a file the private set keeps, but a
  // heading that no longer exists, so it is flattened the same way.
  const isDroppedDecisionLink = (resolved, target) => {
    if (resolved !== DECISION_REGISTER) return false;
    const hash = target.indexOf("#");
    return hash !== -1 && droppedAnchors.has(target.slice(hash + 1));
  };

  const dangling = [];
  const flattened = [];
  const dropped = [];
  const rewritten = files.map((file) => {
    if (!file.to.endsWith(".md")) return file;
    if (VERBATIM_MARKDOWN.some((glob) => matchesGlob(glob, file.to))) return file;
    const text = file.bytes.toString("utf8");
    const flattensTo = (target) => {
      const resolved = resolveLink(file.to, target);
      return pointsIntoPrivate(resolved) || isDroppedDecisionLink(resolved, target);
    };

    for (const match of text.matchAll(MARKDOWN_REFERENCE_DEFINITION)) {
      if (!isExternalLink(match[1])) {
        dangling.push(`${file.to}: reference-style link ${JSON.stringify(match[1])}, which this script does not resolve`);
      }
    }

    // A table row is a line beginning with `|`. One whose relative links all
    // point into the private set goes; a row with no relative link at all — a
    // header, a separator, a row of prose — is not a row about a document and
    // is never dropped.
    let rows = 0;
    const kept = text.split("\n").filter((line) => {
      if (!line.trimStart().startsWith("|")) return true;
      const targets = [...line.matchAll(MARKDOWN_LINK)]
        .map((match) => match[2])
        .filter((target) => !isExternalLink(target));
      if (targets.length === 0) return true;
      if (!targets.every((target) => flattensTo(target))) return true;
      rows += 1;
      return false;
    });

    let count = 0;
    const next = kept.join("\n").replaceAll(MARKDOWN_LINK, (whole, label, target) => {
      if (isExternalLink(target)) return whole;
      const resolved = resolveLink(file.to, target);
      const droppedDecisionLink = isDroppedDecisionLink(resolved, target);
      // A dropped decision's anchor is flattened even though the register
      // file itself still holds — `holds` only sees the file, not the
      // heading a fragment names.
      if (holds(resolved) && !droppedDecisionLink) return whole;
      const listed =
        droppedDecisionLink ||
        pointsIntoPrivate(resolved) ||
        links.find((row) => matchesGlob(row.path, file.to) && matchesGlob(row.target, target));
      if (!listed) {
        dangling.push(`${file.to}: ${JSON.stringify(target)} resolves to ${resolved}, which this tree does not carry`);
        return whole;
      }
      count += 1;
      return label;
    });

    if (rows > 0) dropped.push({ to: file.to, count: rows });
    if (count > 0) flattened.push({ to: file.to, count });
    if (rows === 0 && count === 0) return file;
    return { ...file, bytes: Buffer.from(next, "utf8") };
  });

  if (dangling.length > 0) {
    throw new Error(
      `Refusing to assemble: ${dangling.length} dangling Markdown link(s):\n  ` +
        `${dangling.join("\n  ")}\nEither the target belongs in the open tree, or the link belongs ` +
        `on MARKDOWN_LINKS with a reason, which flattens it to plain text.`,
    );
  }
  return { files: rewritten, flattened, dropped };
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** `*` matches within one path segment, `**` across segments. Nothing else is special. */
function matchesGlob(pattern, path) {
  const source = pattern
    .split("**")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\*", "[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`).test(path);
}

/** The first refused occurrence of `entry` in `text`, or undefined. */
function firstOffence(text, { pattern, allow }) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (allow?.(match)) continue;
    return match[0];
  }
  return undefined;
}

/** Refuses if any file's content matches an INTERNAL_REFERENCE_PATTERNS entry that its path is not allow-listed for. */
function assembleOpenGuard(files, allowlist = ALLOWLIST) {
  const hits = [];
  for (const { to, bytes } of files) {
    if (bytes.includes(0)) continue; // binary; nothing to read for a reference
    const text = bytes.toString("utf8");
    for (const entry of INTERNAL_REFERENCE_PATTERNS) {
      if (entry.only && !entry.only.includes(to)) continue;
      const allowed = allowlist.some((row) => row.patternId === entry.id && matchesGlob(row.path, to));
      if (allowed) continue;
      const offence = firstOffence(text, entry);
      if (offence !== undefined) hits.push(`${to}: ${entry.label} — ${JSON.stringify(offence)}`);
    }
  }
  if (hits.length > 0) {
    throw new Error(
      `Refusing to assemble: ${hits.length} internal reference(s) not on ALLOWLIST:\n  ` +
        `${hits.join("\n  ")}\nIf it is a leak, fix it at the source. If it genuinely belongs, ` +
        `add it to ALLOWLIST with a reason.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

// Names no public tree may carry: the private repository's, and a client's.
// A link into the private repository is a dead end for a public reader, the
// bare name alone says it exists, and a client's name in demo data says who
// the author works for.
//
// The names themselves are not here. They live in PRIVATE_NAMES_FILE, which is
// in the private set, so this script travels into the public tree carrying
// neither a name nor a list of them — a guard that spelled out what it refuses
// would publish the very names it exists to keep back. A public copy of this
// script therefore cannot assemble anything, which is right: the public
// repository is the home repository, and nothing there has a public tree to
// build. There is no allowlist: no file is exempt, this one included.
const PRIVATE_NAMES_FILE = "tooling/package/private-names.json";

/** The private names, read from the repository this script is running out of. */
function privateNames() {
  const path = new URL("./private-names.json", import.meta.url);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read ${PRIVATE_NAMES_FILE}: ${error.message}\n` +
        "The list of names a public tree must not carry is itself private, so this script " +
        "assembles only from the repository that holds it.",
    );
  }
  if (!Array.isArray(parsed.names) || parsed.names.length === 0) {
    throw new Error(
      `${PRIVATE_NAMES_FILE} holds no names. An empty list would let every name through with ` +
        "nothing said, so it is refused rather than obeyed.",
    );
  }
  return parsed.names.map(({ what, pattern, catches, admits }) => {
    try {
      return { what, catches: catches ?? [], admits: admits ?? [], pattern: new RegExp(pattern, "gi") };
    } catch (error) {
      throw new Error(`${PRIVATE_NAMES_FILE}: ${what} has no usable pattern: ${error.message}`);
    }
  });
}

/**
 * Refuses if any carried file names the private repository or a client, in its
 * path or its text, naming the file and the line. Matched over the whole file
 * rather than line by line, so a name a document wrapped across a newline is
 * still found. Files holding a NUL byte are not text and cannot be searched;
 * they are counted and reported, because a name can sit in a screenshot as
 * readily as in a sentence and only a person can see it there.
 */
function privateNameGuard(files, names = privateNames()) {
  const hits = [];
  const unread = [];
  for (const { to, bytes } of files) {
    for (const { pattern, what } of names) {
      pattern.lastIndex = 0;
      if (pattern.test(to)) hits.push(`${to} — ${what}, in the path`);
    }
    if (bytes.includes(0)) {
      unread.push(to);
      continue;
    }
    const text = bytes.toString("utf8");
    for (const { pattern, what } of names) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        hits.push(`${to}:${line} — ${what}`);
      }
    }
  }
  if (hits.length > 0) {
    hits.sort();
    throw new Error(
      `Refusing to assemble: ${hits.length} private name(s) in carried file(s):\n  ` +
        `${hits.join("\n  ")}\nThe public repository must name neither the private repository nor a client.`,
    );
  }
  return unread;
}

function manifest(files) {
  return files.map(({ to, bytes }) => ({
    to,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
}

function printRewrites(label, rows) {
  if (rows.length === 0) return;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  console.log(`\n${total} ${label}:`);
  for (const row of rows) console.log(`  ${String(row.count).padStart(3)}  ${row.to}`);
}

function printExcluded(excluded) {
  const byGlob = new Map();
  for (const row of excluded) byGlob.set(row.glob, (byGlob.get(row.glob) ?? 0) + 1);
  console.log(`\n${excluded.length} file(s) excluded as private:`);
  for (const [glob, count] of [...byGlob].sort()) {
    console.log(`  ${String(count).padStart(4)}  ${glob}`);
  }
}

/** How much the control plane filter took out of the register and the backlog, zero included. */
function printControlPlaneFilter({ droppedDecisionIds, droppedBacklogIds, droppedLabels }) {
  console.log(`\n${droppedDecisionIds.length} decision(s) filtered from ${DECISION_REGISTER}'s control plane section.`);
  console.log(`${droppedBacklogIds.length} backlog entr${droppedBacklogIds.length === 1 ? "y" : "ies"} filtered from ${BACKLOG}'s Control plane milestone.`);
  console.log(
    `${droppedLabels.length} label(s) filtered from ${BACKLOG}, used only by dropped Control plane entr${droppedBacklogIds.length === 1 ? "y" : "ies"}` +
      `${droppedLabels.length > 0 ? `: ${droppedLabels.join(", ")}` : ""}.`,
  );
}

function printManifest(rows) {
  console.log(`${rows.length} file(s):\n`);
  for (const row of rows) {
    console.log(`${row.sha256}  ${String(row.size).padStart(8)}  ${row.to}`);
  }
  const totalBytes = rows.reduce((sum, row) => sum + row.size, 0);
  console.log(`\ntotal: ${rows.length} files, ${totalBytes} bytes`);
}

// ---------------------------------------------------------------------------
// --quotations
// ---------------------------------------------------------------------------

// A founder quotation in the register is italicised and in double quotes:
// *"..."*. Nothing else in the file uses that form.
const VERBATIM_QUOTATION = /\*"[^"]+"\*/g;
// A line that credits the founder without quoting them verbatim: the register
// paraphrases a decision "in the founder's words" or records what "the founder
// asked", and those lines put words in the founder's mouth just the same.
const FOUNDER_CREDIT = /\b(?:in the founder's words|the founder's words|the founder asked)\b/i;

/**
 * Every line of the decision register holding a verbatim founder quotation,
 * with the decision it sits under.
 *
 * The register is read, never edited: what a person said is theirs, and the
 * point of this flag is that they see the list before the tree is pushed rather
 * than a script deciding for them.
 */
function quotations(source) {
  const lines = source.read(DECISION_REGISTER).toString("utf8").split("\n");
  const found = [];
  let decision = "(before the first decision)";
  for (const [index, line] of lines.entries()) {
    const heading = /^#{2,4}\s+(D-\d{3})\b/.exec(line.trim());
    if (heading) decision = heading[1];
    const quoted = [...line.matchAll(VERBATIM_QUOTATION)];
    if (quoted.length > 0 || FOUNDER_CREDIT.test(line)) found.push({ decision, line: index + 1, text: line.trim() });
  }
  return found;
}

function printQuotations(rows) {
  console.log(`${rows.length} line(s) quoting or crediting the founder in ${DECISION_REGISTER}:\n`);
  for (const row of rows) {
    console.log(`${row.decision}  ${DECISION_REGISTER}:${row.line}`);
    console.log(`  ${row.text}\n`);
  }
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

/**
 * Plants one file at every private path pattern and asserts the plan leaves
 * each behind; plants one instance of every refused pattern at a path no
 * ALLOWLIST entry covers and asserts the refusal names each; and checks the
 * things about a real plan a pattern cannot see.
 */
function selfTest(source) {
  const rows = [];

  // One file at each private path pattern, beside the public files that prove
  // the rule is about the path and not about the directory above it.
  const planted = {
    ".focrux/config.json": "{}\n",
    ".focrux/principles.md": "# Principles\n",
    ".focrux/tickets/FCX-1.json": '{"id":"FCX-1"}\n',
    ".focrux/tickets/FCX-1.contract.json": "{}\n",
    "docs/evaluation/README.md": "# Evaluation\n",
    "docs/evaluation/regression-suite.md": "# The regression suite\n",
    "docs/evaluation/spend.md": "# The spend ledger\n",
    "docs/evaluation/stage-9-planted-result.md": "# A result\n",
    "docs/evaluation/desktop-asset-identity.json": "{}\n",
    "docs/reviews/planted-critique.md": "# A critique\n",
    "docs/vision/README.md": "# Vision\n",
    "docs/design/README.md": "# Design\n",
    "docs/design/list-json.md": "# list --json\n",
    "docs/design/Main.dc.html": "<main></main>\n",
    "docs/design/prototypes/planning.html": "<p></p>\n",
    "docs/20-customer-revenue-and-fundraising.md": "# Revenue\n",
    "docs/00-product-thesis.md": "# The thesis\n",
    "tooling/capture/capture.mjs": "export const x = 1;\n",
    "packages/review/src/blocking.ts": "export const x = 1;\n",
  };
  const mustTravel = [
    ".focrux/config.json",
    ".focrux/principles.md",
    "docs/evaluation/regression-suite.md",
    "docs/design/list-json.md",
    "docs/00-product-thesis.md",
    "packages/review/src/blocking.ts",
  ];
  const mustNotTravel = Object.keys(planted).filter((path) => !mustTravel.includes(path));
  const plantedPlan = plan(memorySource(planted));
  const carried = new Set(plantedPlan.entries.map(({ to }) => to));
  for (const path of mustNotTravel) {
    rows.push([!carried.has(path), `${path} is refused by the plan as private`]);
  }
  for (const path of mustTravel) {
    rows.push([carried.has(path), `${path} travels`]);
  }
  rows.push([
    plantedPlan.excluded.length === mustNotTravel.length,
    `every excluded file names the rule that excluded it (${plantedPlan.excluded.length} of ${mustNotTravel.length})`,
  ]);

  const offences = {
    "local-dir": "written to .local/runs/x",
    "evidence-archive": "archived beside SHA256SUMS in the evidence-archive",
    "private-path": "scored in docs/evaluation/stage-1-result.md",
  };
  for (const entry of INTERNAL_REFERENCE_PATTERNS) {
    const text = offences[entry.id];
    if (text === undefined) {
      rows.push([false, `${entry.id}: --self-test plants nothing for this pattern`]);
      continue;
    }
    let refusal;
    try {
      assembleOpenGuard([{ to: "NOTICE", bytes: Buffer.from(`${text}\n`, "utf8") }]);
    } catch (error) {
      refusal = error.message;
    }
    rows.push([
      refusal?.includes(entry.label) ?? false,
      `${entry.id}: planted in an unlisted path, refused naming ${JSON.stringify(entry.label)}`,
    ]);
  }

  // Every private name carries the forms it must refuse and the near misses it
  // must admit, and both are planted here. A pattern that matched only its own
  // sample would pass a test built from that sample, so the list names forms
  // the pattern was not written from: a narrower pattern fails, and so does one
  // widened until it refuses ordinary English.
  const names = privateNames();
  rows.push([names.length > 0, `the private-name list is read and holds ${names.length} name(s)`]);
  for (const { what, catches, admits } of names) {
    if (catches.length === 0) {
      rows.push([false, `${what}: the list plants no form this pattern must catch`]);
      continue;
    }
    const missed = catches.filter((text) => {
      try {
        privateNameGuard([{ to: "README.md", bytes: Buffer.from(`Filed at ${text}.\n`, "utf8") }], names);
        return true;
      } catch {
        return false;
      }
    });
    rows.push([
      missed.length === 0,
      `${what}: every form it must refuse is refused${missed.length === 0 ? "" : ` — missed ${JSON.stringify(missed)}`}`,
    ]);

    const falsePositives = admits.filter((text) => {
      try {
        privateNameGuard([{ to: "README.md", bytes: Buffer.from(`Filed at ${text}.\n`, "utf8") }], names);
        return false;
      } catch {
        return true;
      }
    });
    rows.push([
      falsePositives.length === 0,
      `${what}: every near miss is admitted${falsePositives.length === 0 ? "" : ` — refused ${JSON.stringify(falsePositives)}`}`,
    ]);
  }

  let emptyListRefusal;
  try {
    privateNameGuard([{ to: "README.md", bytes: Buffer.from("anything\n", "utf8") }], []);
    emptyListRefusal = undefined;
  } catch (error) {
    emptyListRefusal = error.message;
  }
  rows.push([emptyListRefusal === undefined, "an empty list guards nothing, which is why privateNames refuses to return one"]);

  let pathRefusal;
  try {
    privateNameGuard([{ to: `docs/${names[0]?.catches[0] ?? ""}-notes.md`, bytes: Buffer.from("x\n", "utf8") }], names);
  } catch (error) {
    pathRefusal = error.message;
  }
  rows.push([pathRefusal?.includes("in the path") ?? false, "a private name in a file's path is refused, not only in its text"]);

  let cleanRefusal;
  try {
    privateNameGuard([{ to: "README.md", bytes: Buffer.from("Filed at example/webstore.\n", "utf8") }], names);
  } catch (error) {
    cleanRefusal = error.message;
  }
  rows.push([cleanRefusal === undefined, "a file naming nobody private is admitted"]);

  rows.push([
    !plan(memorySource(planted)).entries.some(({ to }) => to === PRIVATE_NAMES_FILE),
    `${PRIVATE_NAMES_FILE} does not travel`,
  ]);

  const citation =
    "// SCP-094 and D-010 count different things; ADR-0023 says why. See docs/04, and the method\n" +
    "// documents under docs/evaluation.\n";
  let citationRefused;
  try {
    assembleOpenGuard([{ to: "packages/review/src/blocking.ts", bytes: Buffer.from(citation, "utf8") }]);
  } catch (error) {
    citationRefused = error.message;
  }
  rows.push([
    citationRefused === undefined,
    "this repository's own identifiers are public: SCP, D, ADR, docs/NN and the evaluation directory are admitted",
  ]);

  let linkRefusal;
  try {
    resolveMarkdownLinks([
      { to: "README.md", bytes: Buffer.from("See [the plan](docs/planted-absent.md).\n", "utf8") },
    ]);
  } catch (error) {
    linkRefusal = error.message;
  }
  rows.push([
    linkRefusal?.includes("docs/planted-absent.md") ?? false,
    "an unlisted dangling Markdown link is refused, naming the file and the link",
  ]);

  const flattenedLink = resolveMarkdownLinks([
    {
      to: "AGENTS.md",
      bytes: Buffer.from("Recorded in [`stage-1-result.md`](docs/evaluation/stage-1-result.md).\n", "utf8"),
    },
  ]);
  rows.push([
    !flattenedLink.files[0].bytes.toString("utf8").includes("](") && flattenedLink.flattened.length === 1,
    "a link into the private set is flattened to plain text rather than published as a 404",
  ]);

  const table = resolveMarkdownLinks([
    {
      to: "docs/README.md",
      bytes: Buffer.from(
        "| | |\n|---|---|\n" +
          "| [`20-revenue`](20-customer-revenue-and-fundraising.md) | Revenue |\n" +
          "| [`adr/`](adr/README.md), [`boards`](design/Main.dc.html) | Records |\n",
        "utf8",
      ),
    },
    { to: "docs/adr/README.md", bytes: Buffer.from("# ADRs\n", "utf8") },
  ]);
  const tableText = table.files[0].bytes.toString("utf8");
  rows.push([
    !tableText.includes("20-customer-revenue-and-fundraising.md") &&
      tableText.includes("(adr/README.md)") &&
      !tableText.includes("design/Main.dc.html)") &&
      table.dropped.length === 1,
    "a table row whose only link is private is dropped, and a mixed row keeps its public link and flattens the private one",
  ]);

  const { entries, excluded } = plan(source);
  const leaked = entries.filter(({ to }) => isPrivate(to));
  rows.push([leaked.length === 0, `the real plan carries nothing private (${leaked.length} found)`]);
  // In the archive the rules exclude hundreds of files; in the tree they produce
  // there is nothing left to exclude. Either way, every private path goes.
  const privateInSource = source.list().filter((path) => isPrivate(path)).length;
  rows.push([
    excluded.length === privateInSource,
    `the real plan leaves every private path behind (${excluded.length} of ${privateInSource})`,
  ]);
  rows.push([
    entries.some(({ to }) => to === ".focrux/config.json") &&
      !entries.some(({ to }) => to.startsWith(".focrux/tickets/")),
    "the real plan holds .focrux/config.json and no .focrux/tickets/",
  ]);
  for (const required of ["README.md", "LICENSE", "NOTICE", "CONTRIBUTING.md", "AGENTS.md"]) {
    rows.push([entries.some(({ to }) => to === required), `the real plan holds ${required}`]);
  }

  // The control plane filter: planted rather than read from the real register
  // and backlog, since the section and the milestone do not exist on every
  // branch — the filter has to be exercised whether or not this run's tree
  // carries one.
  const plantedRegister =
    "## The product\n\n### D-001 — Public\n\n- Owner: Founder\n\n" +
    "## The control plane\n\n### D-900 — Hosted, first\n\n- Owner: Founder\n\n" +
    "### D-901 — Hosted, second\n\n- Owner: Founder\n\n" +
    "## Work and planning\n\n### D-002 — Also public\n\n- Owner: Founder\n";
  const registerFiltered = filterControlPlaneRegister(plantedRegister);
  rows.push([
    !registerFiltered.text.includes(CONTROL_PLANE_SECTION_HEADING) &&
      !registerFiltered.text.includes("D-900") &&
      !registerFiltered.text.includes("D-901") &&
      registerFiltered.text.includes("## Work and planning") &&
      registerFiltered.text.includes("D-002") &&
      registerFiltered.droppedIds.length === 2,
    "the control plane section and its decisions are filtered from a planted register, and the next section survives",
  ]);

  const plantedBacklog = JSON.stringify({
    labels: [
      { name: "type:feature", color: "0E8A16", description: "Product or platform capability" },
      { name: "area:commercial", color: "5319E7", description: "Hosted plane commercial work" },
      { name: "status:done", color: "cccccc", description: "Closed" },
    ],
    issues: [
      { id: "SCP-001", milestone: "Release", labels: ["type:feature"], depends_on: [] },
      { id: "SCP-900", milestone: "Control plane", labels: ["type:feature", "area:commercial"], depends_on: [] },
    ],
    milestones: [
      { title: "Release", description: "x" },
      { title: "Control plane", description: "y" },
    ],
  });
  const backlogFiltered = filterControlPlaneBacklog(plantedBacklog);
  const filteredBacklogData = JSON.parse(backlogFiltered.text);
  rows.push([
    filteredBacklogData.issues.length === 1 &&
      filteredBacklogData.issues[0].id === "SCP-001" &&
      filteredBacklogData.milestones.length === 1 &&
      backlogFiltered.droppedIds.length === 1 &&
      backlogFiltered.droppedMilestone,
    "a planted Control plane backlog entry and its milestone are filtered, the public entry kept",
  ]);
  rows.push([
    !filteredBacklogData.labels.some((label) => label.name === "area:commercial") &&
      filteredBacklogData.labels.some((label) => label.name === "type:feature") &&
      filteredBacklogData.labels.some((label) => label.name === "status:done") &&
      backlogFiltered.droppedLabels.length === 1 &&
      backlogFiltered.droppedLabels[0] === "area:commercial",
    "a label used only by the dropped Control plane entry is filtered; a label a public entry also uses, " +
      "and a label nobody uses, both stay",
  ]);

  let dependencyRefusal;
  try {
    filterControlPlaneBacklog(
      JSON.stringify({
        issues: [
          { id: "SCP-001", milestone: "Release", depends_on: ["SCP-900"] },
          { id: "SCP-900", milestone: "Control plane", depends_on: [] },
        ],
        milestones: [
          { title: "Release", description: "x" },
          { title: "Control plane", description: "y" },
        ],
      }),
    );
  } catch (error) {
    dependencyRefusal = error.message;
  }
  rows.push([
    (dependencyRefusal?.includes("SCP-001") ?? false) && (dependencyRefusal?.includes("SCP-900") ?? false),
    "a public backlog entry depending on a dropped Control plane entry refuses, naming both",
  ]);

  let bypassRefusal;
  try {
    controlPlaneGuard([{ to: DECISION_REGISTER, bytes: Buffer.from(plantedRegister, "utf8") }]);
  } catch (error) {
    bypassRefusal = error.message;
  }
  rows.push([
    bypassRefusal?.includes(CONTROL_PLANE_SECTION_HEADING) ?? false,
    "controlPlaneGuard refuses an unfiltered register, naming the control plane heading",
  ]);

  // A backlog whose Control plane entries are already gone (so the earlier
  // milestone check does not fire first) but whose labels array still
  // declares a label only one of them used.
  const labelSurvivorBacklog = JSON.stringify({
    labels: [
      { name: "type:feature", color: "0E8A16", description: "x" },
      { name: "area:commercial", color: "5319E7", description: "y" },
    ],
    issues: [{ id: "SCP-001", milestone: "Release", labels: ["type:feature"], depends_on: [] }],
    milestones: [{ title: "Release", description: "x" }],
  });
  let labelBypassRefusal;
  try {
    controlPlaneGuard([{ to: BACKLOG, bytes: Buffer.from(labelSurvivorBacklog, "utf8") }], { droppedLabels: ["area:commercial"] });
  } catch (error) {
    labelBypassRefusal = error.message;
  }
  rows.push([
    labelBypassRefusal?.includes("area:commercial") ?? false,
    "controlPlaneGuard refuses a backlog that still declares a label used only by a dropped Control plane entry",
  ]);

  let citationRefusal;
  try {
    controlPlaneGuard(
      [
        { to: DECISION_REGISTER, bytes: Buffer.from(registerFiltered.text, "utf8") },
        { to: BACKLOG, bytes: Buffer.from(backlogFiltered.text, "utf8") },
        {
          to: "packages/review/src/blocking.ts",
          bytes: Buffer.from("// See D-900 and SCP-900 for background.\n", "utf8"),
        },
      ],
      { droppedDecisionIds: registerFiltered.droppedIds, droppedBacklogIds: backlogFiltered.droppedIds },
    );
  } catch (error) {
    citationRefusal = error.message;
  }
  rows.push([
    (citationRefusal?.includes("packages/review/src/blocking.ts:1") ?? false) &&
      (citationRefusal?.includes("D-900") ?? false) &&
      (citationRefusal?.includes("SCP-900") ?? false),
    "controlPlaneGuard refuses a public file citing a dropped decision id and a dropped backlog id, naming file and line",
  ]);

  let exemptedCitationRefusal;
  try {
    controlPlaneGuard(
      [{ to: "tooling/package/assemble-open.test.mjs", bytes: Buffer.from("// See D-900 for background.\n", "utf8") }],
      { droppedDecisionIds: ["D-900"] },
      [{ glob: "tooling/package/assemble-open.test.mjs", reason: "planted test fixture" }],
    );
  } catch (error) {
    exemptedCitationRefusal = error.message;
  }
  rows.push([
    exemptedCitationRefusal === undefined,
    "a file on the private-id exemption list citing a dropped id is not refused",
  ]);

  for (const [ok, description] of rows) console.log(`${ok ? "pass" : "FAIL"}  ${description}`);
  const failed = rows.filter(([ok]) => !ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} rows pass`);
  if (failed.length > 0) {
    throw new Error(`self-test failed: ${failed.length} row(s) — ${failed.map(([, d]) => d).join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
// --verify
// ---------------------------------------------------------------------------

/**
 * A fixed author and date, so `ensureGitRepo` produces the same commit sha
 * from the same tree every run — the point of pinning the source to a commit
 * in the first place.
 */
const ASSEMBLED_COMMIT_IDENTITY = {
  name: "Focrux",
  email: "focrux@users.noreply.github.com",
  date: "2026-01-01T00:00:00Z",
};

/**
 * Makes `target` a git repository with one commit holding everything in it,
 * unless it already is one (its own `.git`, left alone either way).
 *
 * The public repository will be one commit of this assembled tree, and the
 * tree's own tests expect a git repository under them — `git ls-files`, a
 * commit-sha check — which a bare directory refuses with "not a git
 * repository". `--verify` is the whole answer about whether the tree stands
 * on its own, so it has to run in the shape the tree will actually ship in.
 */
function ensureGitRepo(target) {
  if (existsSync(join(target, ".git"))) return;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: ASSEMBLED_COMMIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: ASSEMBLED_COMMIT_IDENTITY.email,
    GIT_AUTHOR_DATE: ASSEMBLED_COMMIT_IDENTITY.date,
    GIT_COMMITTER_NAME: ASSEMBLED_COMMIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: ASSEMBLED_COMMIT_IDENTITY.email,
    GIT_COMMITTER_DATE: ASSEMBLED_COMMIT_IDENTITY.date,
  };
  execFileSync("git", ["init", "-b", "main"], { cwd: target, stdio: "inherit" });
  execFileSync("git", ["add", "-A"], { cwd: target, stdio: "inherit" });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "Assembled tree"], {
    cwd: target,
    stdio: "inherit",
    env,
  });
}

/** Installs and runs the assembled tree's own gate inside it, with no reference to this repository. */
function verify(target) {
  ensureGitRepo(target);
  const steps = [
    ["pnpm", ["install", "--frozen-lockfile"]],
    // `--continue` so the report names every task that fails, not the first:
    // the point of --verify is the whole answer about a tree, not the earliest
    // reason to stop looking at it.
    ["pnpm", ["exec", "turbo", "run", "build", "typecheck", "test", "lint", "--concurrency=2", "--continue"]],
    ["python3", ["scripts/validate_backlog.py"]],
    ["python3", ["scripts/validate_docs.py"]],
  ];
  for (const [command, args] of steps) {
    console.log(`\n=== ${command} ${args.join(" ")}  (in ${target})`);
    try {
      execFileSync(command, args, { cwd: target, stdio: "inherit", env: { ...process.env, CI: "1" } });
    } catch (error) {
      throw new Error(`verify failed at \`${command} ${args.join(" ")}\`: ${error.message}`);
    }
  }
  console.log(`\nverify passed: ${target} installs and passes its own gate.`);
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let target;
  let dryRun = false;
  let selfTest = false;
  let verifyOnly = false;
  let quotationsOnly = false;
  let commit = "HEAD";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--self-test") {
      selfTest = true;
    } else if (arg === "--verify") {
      verifyOnly = true;
    } else if (arg === "--quotations") {
      quotationsOnly = true;
    } else if (arg === "--commit") {
      commit = argv[i + 1];
      i += 1;
      if (!commit) throw new Error("--commit needs a commit-ish");
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (target === undefined) {
      target = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  if (selfTest) {
    if (target || dryRun || verifyOnly || quotationsOnly) {
      throw new Error("--self-test takes no target and no other flag");
    }
    return { selfTest: true, commit };
  }
  if (quotationsOnly) {
    if (target || dryRun || verifyOnly) throw new Error("--quotations takes no target and no other flag");
    return { quotationsOnly: true, commit };
  }
  if (!target) {
    throw new Error(
      "Usage: node tooling/package/assemble-open.mjs <target-dir> [--dry-run] [--commit <sha>]\n" +
        "   or: node tooling/package/assemble-open.mjs <target-dir> --verify\n" +
        "   or: node tooling/package/assemble-open.mjs --self-test\n" +
        "   or: node tooling/package/assemble-open.mjs --quotations",
    );
  }
  if (verifyOnly && dryRun) throw new Error("--verify and --dry-run ask for opposite things");
  return { target: resolve(target), dryRun, verifyOnly, selfTest: false, commit };
}

function main(argv) {
  const args = parseArgs(argv);

  if (args.selfTest) {
    selfTest(commitSource(args.commit));
    return;
  }

  if (args.quotationsOnly) {
    printQuotations(quotations(commitSource(args.commit)));
    return;
  }

  const { target, dryRun, verifyOnly, commit } = args;

  if (verifyOnly) {
    if (!existsSync(join(target, "package.json"))) {
      throw new Error(`${target} holds no assembled tree — assemble it before --verify`);
    }
    verify(target);
    return;
  }

  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) throw new Error(`${target} exists and is not a directory`);
    if (readdirSync(target).length > 0) {
      throw new Error(`${target} exists and is not empty — refusing to write into it`);
    }
  }

  const source = commitSource(commit);
  const { entries, excluded } = plan(source);
  const controlPlane = filterControlPlane(resolveFiles(source, entries));
  const { files, flattened, dropped } = resolveMarkdownLinks(
    controlPlane.files,
    MARKDOWN_LINKS,
    controlPlane.droppedAnchors,
  );
  assembleOpenGuard(files, ALLOWLIST);
  controlPlaneGuard(files, controlPlane);
  const unsearchable = privateNameGuard(files);
  if (unsearchable.length > 0) {
    console.log(
      `\n${unsearchable.length} carried file(s) hold no text and were not searched for a private name; ` +
        "a name in a picture is for a person to see:\n  " +
        `${unsearchable.join("\n  ")}\n`,
    );
  }

  if (dryRun) {
    console.log(`dry run from ${source.describe} — nothing written to ${target}\n`);
    printManifest(manifest(files));
    printExcluded(excluded);
    printRewrites("link(s) into the private set flattened to plain text", flattened);
    printRewrites("table row(s) dropped, their every link being into the private set", dropped);
    printControlPlaneFilter(controlPlane);
    return;
  }

  mkdirSync(target, { recursive: true });
  for (const { to, bytes } of files) {
    const dest = join(target, to);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    if (source.executable?.has(to)) chmodSync(dest, 0o755);
  }

  console.log(`assembled ${target} from ${source.describe}\n`);
  printManifest(manifest(files));
  printExcluded(excluded);
  printRewrites("link(s) into the private set flattened to plain text", flattened);
  printRewrites("table row(s) dropped, their every link being into the private set", dropped);
  printControlPlaneFilter(controlPlane);
}

export {
  ALLOWLIST,
  assembleOpenGuard,
  BACKLOG,
  CONTROL_PLANE_MILESTONE,
  isControlPlaneMilestone,
  CONTROL_PLANE_SECTION_HEADING,
  controlPlaneGuard,
  decisionAnchor,
  DECISION_REGISTER,
  ensureGitRepo,
  filterControlPlane,
  filterControlPlaneBacklog,
  filterControlPlaneRegister,
  FRONT_DOOR,
  EVALUATION_METHOD,
  INTERNAL_REFERENCE_PATTERNS,
  isPrivate,
  MARKDOWN_LINKS,
  matchesGlob,
  memorySource,
  plan,
  PRIVATE_ID_EXEMPTIONS,
  PRIVATE_PATHS,
  privateNameGuard,
  quotations,
  resolveMarkdownLinks,
  VERBATIM_MARKDOWN,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
