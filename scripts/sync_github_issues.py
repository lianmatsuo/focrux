#!/usr/bin/env python3
"""Reconcile GitHub issues, labels and milestones with backlog/issues.json.

Dry-run by default. Requires the GitHub CLI (`gh`) authenticated with write access.

Unlike a create-only script, this converges: it creates missing issues, updates
changed ones, and closes issues in two distinct ways. An issue whose backlog
entry was removed closes as `not planned` with `--close-reason`. An issue whose
entry carries the `status:done` label closes as `completed`: the label reaches
GitHub through the ordinary update (or the create, for a done entry that never
had an issue), and the close carries one comment naming the pull request or
commit the entry's `notes` cite — the last `#NNN`, or the last 7–40 hexadecimal
digest, in the notes. Both kinds of closure are refused under `--apply` unless
every id is repeated as `--expect-close`, so nothing closes that the dry run
did not show. Backlog IDs are stable identifiers, so an issue is matched by its
`[SCP-NNN]` title prefix.
"""
from __future__ import annotations

from pathlib import Path
import argparse
import json
import re
import subprocess
import sys
import tempfile

from git_remote import github_repository_from_remote
from validate_backlog import BacklogValidationError, DONE_LABEL, load_validated_backlog

ROOT = Path(__file__).resolve().parents[1]

PULL_REQUEST_REFERENCE = re.compile(r"#\d+")
# A short or full commit digest. Requiring a digit and a letter keeps ordinary
# words such as "defaced" and plain numbers out; the price is a digest with
# neither, which is rare enough to name by hand.
COMMIT_REFERENCE = re.compile(r"\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b")


def closing_reference(notes: str) -> str | None:
    """The last pull request or commit the notes cite; the closing sentence is appended last."""
    candidates = [(match.end(), match.group(0)) for match in PULL_REQUEST_REFERENCE.finditer(notes)]
    candidates += [(match.end(), match.group(0)) for match in COMMIT_REFERENCE.finditer(notes)]
    return max(candidates)[1] if candidates else None


def done_comment(backlog_id: str, notes: str) -> str:
    reference = closing_reference(notes)
    if reference is None:
        return f"Done — the backlog entry for {backlog_id} carries {DONE_LABEL} and cites no pull request or commit."
    return f"Done in {reference} — the backlog entry for {backlog_id} carries {DONE_LABEL}."


parser = argparse.ArgumentParser()
parser.add_argument(
    "--repo",
    help="owner/repository; defaults to the GitHub repository this checkout's `origin` remote names",
)
parser.add_argument("--apply", action="store_true", help="Perform writes; otherwise report the plan")
parser.add_argument(
    "--expect-close",
    action="append",
    default=[],
    metavar="SCP-NNN",
    help="Repeat for every issue the dry-run says will close, removed or done; --apply requires an exact match",
)
parser.add_argument(
    "--close-reason",
    default="Removed from the backlog. See docs/11-open-decisions.md for the decision that removed it.",
    help="Comment posted when closing an issue whose backlog entry is gone",
)
args = parser.parse_args()


def repository_from_origin() -> str:
    """The GitHub repository this checkout pushes to, so no script names one.

    Read from ROOT, the checkout holding the backlog, and never from the working
    directory: the repository whose issues are written must be the repository
    whose backlog is read, whatever directory the command was run from. The push
    URL, not the fetch one, because this script writes; they are the same remote
    unless someone has set them apart, and then the writes must follow the push.
    """
    try:
        url = subprocess.run(
            ["git", "-C", str(ROOT), "remote", "get-url", "--push", "origin"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except subprocess.CalledProcessError as error:
        raise SystemExit(
            "Pass --repo: this checkout has no `origin` remote to read the repository from."
        ) from error
    try:
        return github_repository_from_remote(url)
    except ValueError as error:
        raise SystemExit(f"Pass --repo: `origin` is {url.strip()}, which is not a GitHub remote.") from error


repository = args.repo or repository_from_origin()

try:
    data = load_validated_backlog(ROOT / "backlog/issues.json")
except BacklogValidationError as error:
    sys.exit("Backlog validation failed:\n- " + "\n- ".join(error.errors))

issues = {item["id"]: item for item in data["issues"]}
known_labels = {label["name"] for label in data["labels"]}


def gh(command: list[str], check: bool = True) -> str:
    result = subprocess.run(["gh", *command], capture_output=True, text=True)
    if check and result.returncode != 0:
        sys.exit(f"gh {' '.join(command)}\n{result.stderr}")
    return result.stdout.strip()


if args.apply:
    try:
        subprocess.run(["gh", "--version"], check=True, capture_output=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        sys.exit("Install and authenticate the GitHub CLI before using --apply")

# Resolve the closure plan before the first write. A closure is intentional
# only when the caller names that exact issue after reading the dry run.
raw_issues = gh(["issue", "list", "--repo", repository, "--state", "all",
                 "--limit", "500", "--json", "number,title,state,body,milestone,labels"])
existing: dict[str, dict] = {}
for issue in json.loads(raw_issues):
    match = re.match(r"\[(SCP-\d+)\]", issue["title"])
    if match:
        existing[match.group(1)] = issue

# backlog id -> "removed" (entry gone) or "done" (entry carries the label).
planned_closures: dict[str, str] = {}
for backlog_id, issue in existing.items():
    if issue["state"] != "OPEN":
        continue
    if backlog_id not in issues:
        planned_closures[backlog_id] = "removed"
    elif DONE_LABEL in issues[backlog_id]["labels"]:
        planned_closures[backlog_id] = "done"
for backlog_id, item in issues.items():
    # A done entry that never reached GitHub is created and closed in one run,
    # so the record exists where the ADRs and documents point.
    if DONE_LABEL in item["labels"] and backlog_id not in existing:
        planned_closures[backlog_id] = "done"

expected_closures = set(args.expect_close)
if args.apply and set(planned_closures) != expected_closures:
    planned = " ".join(sorted(planned_closures)) or "(none)"
    expected = " ".join(sorted(expected_closures)) or "(none)"
    sys.exit(
        "Refusing --apply before any writes: the planned close set does not exactly match "
        f"--expect-close.\nPlanned: {planned}\nExpected: {expected}\n"
        "Review the dry-run, then repeat --expect-close once for every planned closure."
    )

# Labels and milestones first: an issue cannot reference one that does not exist.
for label in data["labels"]:
    if args.apply:
        gh([
            "label", "create", label["name"], "--repo", repository,
            "--color", label["color"], "--description", label["description"], "--force",
        ])

existing_milestones: dict[str, str] = {}
if args.apply:
    raw = gh(["api", f"repos/{repository}/milestones", "-X", "GET", "-f", "state=all",
              "--jq", ".[] | [.title, (.number|tostring)] | @tsv"], check=False)
    existing_milestones = dict(line.split("\t") for line in raw.splitlines() if "\t" in line)

for milestone in data["milestones"]:
    if not args.apply:
        continue
    if milestone["title"] in existing_milestones:
        gh(["api", f"repos/{repository}/milestones/{existing_milestones[milestone['title']]}",
            "-X", "PATCH", "-f", f"description={milestone['description']}", "--jq", ".title"])
    else:
        gh(["api", f"repos/{repository}/milestones", "--method", "POST",
            "-f", f"title={milestone['title']}",
            "-f", f"description={milestone['description']}", "--jq", ".number"])

def body_for(item: dict) -> str:
    lines = [
        f"<!-- backlog-id:{item['id']} -->",
        f"**Backlog ID:** `{item['id']}`",
        "",
        "## Desired outcome",
        "",
        item["outcome"],
        "",
        "## Dependencies",
        "",
    ]
    lines += [f"- `{dep}` — {issues[dep]['title']}" for dep in item["depends_on"]] or ["- None"]
    lines += ["", "## Acceptance criteria", ""]
    lines += [f"- [ ] {criterion}" for criterion in item["acceptance_criteria"]]
    if item.get("notes"):
        lines += ["", "## Notes", "", item["notes"]]
    lines += ["", "---", "", "Generated from `backlog/issues.json`. Edit the backlog, then re-run this script."]
    return "\n".join(lines)


def normalise(text: str) -> str:
    """GitHub returns CRLF and trims trailing space; compare what it stores."""
    return "\n".join(line.rstrip() for line in (text or "").replace("\r\n", "\n").split("\n")).strip()


def close_done(backlog_id: str, number: int) -> None:
    gh(["issue", "close", str(number), "--repo", repository,
        "--reason", "completed", "--comment", done_comment(backlog_id, issues[backlog_id].get("notes", ""))])


created: list[str] = []
updated: list[str] = []
unchanged: list[str] = []
closed_removed: list[str] = []
closed_done: list[str] = []

for backlog_id in sorted(planned_closures):
    if planned_closures[backlog_id] != "removed":
        continue
    issue = existing[backlog_id]
    if args.apply:
        gh(["issue", "close", str(issue["number"]), "--repo", repository,
            "--reason", "not planned", "--comment", args.close_reason])
    closed_removed.append(backlog_id)

for backlog_id, item in issues.items():
    labels = [label for label in item["labels"] if label in known_labels]
    title = f"[{backlog_id}] {item['title']}"
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
        handle.write(body_for(item))
        body_path = handle.name

    if backlog_id in existing:
        current = existing[backlog_id]
        # Only write what actually differs. Editing all of them unconditionally
        # costs an API call each and makes this script's output say nothing.
        current_labels = {label["name"] for label in current.get("labels", [])}
        current_milestone = (current.get("milestone") or {}).get("title")
        differs = (
            current["title"] != title
            or normalise(current.get("body", "")) != normalise(body_for(item))
            or current_milestone != item["milestone"]
            or not set(labels) <= current_labels
        )
        if differs:
            if args.apply:
                gh(["issue", "edit", str(current["number"]), "--repo", repository,
                    "--title", title, "--body-file", body_path, "--milestone", item["milestone"],
                    *sum([["--add-label", label] for label in labels], [])])
            updated.append(backlog_id)
        else:
            unchanged.append(backlog_id)
        # The update above put `status:done` on the issue; closing follows it.
        if planned_closures.get(backlog_id) == "done":
            if args.apply:
                close_done(backlog_id, current["number"])
            closed_done.append(backlog_id)
    else:
        number: int | None = None
        if args.apply:
            url = gh(["issue", "create", "--repo", repository, "--title", title,
                      "--body-file", body_path, "--milestone", item["milestone"],
                      *sum([["--label", label] for label in labels], [])])
            created_match = re.search(r"/issues/(\d+)\s*$", url)
            if created_match is None:
                sys.exit(f"gh issue create for {backlog_id} did not return an issue URL:\n{url}")
            number = int(created_match.group(1))
        created.append(backlog_id)
        if planned_closures.get(backlog_id) == "done":
            if args.apply:
                assert number is not None
                close_done(backlog_id, number)
            closed_done.append(backlog_id)
    Path(body_path).unlink(missing_ok=True)

print("APPLIED" if args.apply else "DRY RUN — re-run with --apply to write")
print(f"  create: {len(created)}" + (f" -> {' '.join(sorted(created))}" if created else ""))
print(f"  update: {len(updated)}" + (f" -> {' '.join(sorted(updated))}" if 0 < len(updated) <= 24 else ""))
print(f"  unchanged: {len(unchanged)}")
print(f"  close (removed): {len(closed_removed)}"
      + (f" -> {' '.join(sorted(closed_removed))}" if closed_removed else ""))
print(f"  close (done): {len(closed_done)}"
      + (f" -> {' '.join(sorted(closed_done))}" if closed_done else ""))
