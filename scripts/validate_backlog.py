#!/usr/bin/env python3
"""Validate the machine-readable backlog before it reaches GitHub."""
from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
BACKLOG_PATH = ROOT / "backlog/issues.json"

TOP_LEVEL_REQUIRED_KEYS = {"version", "generated_at", "milestones", "labels", "issues"}
TOP_LEVEL_KEYS = TOP_LEVEL_REQUIRED_KEYS | {"revision_note"}
MILESTONE_KEYS = {"title", "description", "title_note"}
LABEL_KEYS = {"name", "color", "description"}
ISSUE_KEYS = {
    "id",
    "title",
    "milestone",
    "labels",
    "outcome",
    "acceptance_criteria",
    "depends_on",
    "notes",
    "state",
}
ISSUE_ID = re.compile(r"SCP-\d{3,}$")
# `SCP-NEW-<label>` until scripts/assign_ids.py numbers it at merge. The label
# has the shape of repository_rules.PLACEHOLDER_LABEL.
ISSUE_PLACEHOLDER = re.compile(r"SCP-NEW-[a-z0-9]+(?:-[a-z0-9]+)*")
HEX_COLOR = re.compile(r"[0-9A-Fa-f]{6}$")
# An entry is done when it carries both: the label is what GitHub sees and what
# `sync_github_issues.py` closes on; `state` is the field older tooling reads.
# Requiring both means neither can say done while the other says open.
DONE_LABEL = "status:done"


class BacklogValidationError(ValueError):
    """Raised when backlog data does not satisfy its repository contract."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = tuple(errors)
        super().__init__("\n".join(errors))


class DuplicateJsonKeyError(ValueError):
    """Raised before JSON's last-value-wins behavior can hide backlog data."""


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    record: dict[str, object] = {}
    for key, value in pairs:
        if key in record:
            raise DuplicateJsonKeyError(f"duplicate JSON key {key!r}")
        record[key] = value
    return record


def _validate_keys(
    record: dict[str, object],
    path: str,
    required: set[str],
    allowed: set[str],
    errors: list[str],
) -> None:
    missing = sorted(required - record.keys())
    unknown = sorted(record.keys() - allowed)
    for key in missing:
        errors.append(f"{path}: missing required field {key!r}")
    for key in unknown:
        errors.append(f"{path}: unknown field {key!r}")


def _required_string(
    record: dict[str, object], key: str, path: str, errors: list[str]
) -> str | None:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}.{key}: expected a non-empty string")
        return None
    return value


def _required_string_list(
    record: dict[str, object],
    key: str,
    path: str,
    errors: list[str],
    *,
    allow_empty: bool,
) -> list[str]:
    value = record.get(key)
    if not isinstance(value, list):
        errors.append(f"{path}.{key}: expected a list of strings")
        return []
    invalid = [
        index
        for index, item in enumerate(value)
        if not isinstance(item, str) or not item.strip()
    ]
    if invalid:
        errors.append(f"{path}.{key}: non-empty strings required at indexes {invalid}")
        return []
    if not allow_empty and not value:
        errors.append(f"{path}.{key}: must contain at least one item")
    strings = [item for item in value if isinstance(item, str)]
    if len(strings) != len(set(strings)):
        errors.append(f"{path}.{key}: duplicate values are not allowed")
    return strings


def _object_records(
    value: object, path: str, errors: list[str]
) -> list[tuple[int, dict[str, object]]]:
    if not isinstance(value, list):
        errors.append(f"{path}: expected a list of objects")
        return []
    records: list[tuple[int, dict[str, object]]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict) or not all(isinstance(key, str) for key in item):
            errors.append(f"{path}[{index}]: expected an object with string keys")
            continue
        records.append((index, item))
    return records


def validate_backlog_data(data: object, *, strict: bool = False) -> list[str]:
    """Return every structural and relational error in backlog data, and with `strict` every placeholder id."""
    errors: list[str] = []
    if not isinstance(data, dict) or not all(isinstance(key, str) for key in data):
        return ["backlog: expected an object with string keys"]

    _validate_keys(data, "backlog", TOP_LEVEL_REQUIRED_KEYS, TOP_LEVEL_KEYS, errors)
    if data.get("version") != 4:
        errors.append("backlog.version: expected integer 4")

    generated_at = data.get("generated_at")
    if not isinstance(generated_at, str):
        errors.append("backlog.generated_at: expected an ISO date")
    else:
        try:
            parsed_date = date.fromisoformat(generated_at)
            if parsed_date.isoformat() != generated_at:
                raise ValueError
        except ValueError:
            errors.append("backlog.generated_at: expected an ISO date in YYYY-MM-DD form")
    if "revision_note" in data:
        _required_string(data, "revision_note", "backlog", errors)

    milestones = _object_records(data.get("milestones"), "backlog.milestones", errors)
    milestone_names: set[str] = set()
    for index, milestone in milestones:
        path = f"backlog.milestones[{index}]"
        _validate_keys(milestone, path, {"title", "description"}, MILESTONE_KEYS, errors)
        title = _required_string(milestone, "title", path, errors)
        _required_string(milestone, "description", path, errors)
        if "title_note" in milestone:
            _required_string(milestone, "title_note", path, errors)
        if title in milestone_names:
            errors.append(f"{path}.title: duplicate milestone {title!r}")
        elif title is not None:
            milestone_names.add(title)

    labels = _object_records(data.get("labels"), "backlog.labels", errors)
    label_names: set[str] = set()
    for index, label in labels:
        path = f"backlog.labels[{index}]"
        _validate_keys(label, path, LABEL_KEYS, LABEL_KEYS, errors)
        name = _required_string(label, "name", path, errors)
        color = _required_string(label, "color", path, errors)
        _required_string(label, "description", path, errors)
        if color is not None and HEX_COLOR.fullmatch(color) is None:
            errors.append(f"{path}.color: expected exactly six hexadecimal digits")
        if name in label_names:
            errors.append(f"{path}.name: duplicate label {name!r}")
        elif name is not None:
            label_names.add(name)

    issues = _object_records(data.get("issues"), "backlog.issues", errors)
    if not issues:
        errors.append("backlog.issues: must contain at least one issue")
    issue_records: dict[str, tuple[str | None, list[str], list[str]]] = {}
    required_issue_keys = ISSUE_KEYS - {"notes", "state"}
    for index, issue in issues:
        path = f"backlog.issues[{index}]"
        _validate_keys(issue, path, required_issue_keys, ISSUE_KEYS, errors)
        issue_id = _required_string(issue, "id", path, errors)
        _required_string(issue, "title", path, errors)
        milestone = _required_string(issue, "milestone", path, errors)
        issue_labels = _required_string_list(issue, "labels", path, errors, allow_empty=False)
        _required_string(issue, "outcome", path, errors)
        _required_string_list(issue, "acceptance_criteria", path, errors, allow_empty=False)
        dependencies = _required_string_list(issue, "depends_on", path, errors, allow_empty=True)
        if "notes" in issue and not isinstance(issue.get("notes"), str):
            errors.append(f"{path}.notes: expected a string")
        if "state" in issue and issue.get("state") != "done":
            errors.append(f"{path}.state: expected 'done' when present")
        state_done = issue.get("state") == "done"
        label_done = DONE_LABEL in issue_labels
        if state_done and not label_done:
            errors.append(f"{path}: state 'done' requires the {DONE_LABEL!r} label")
        if label_done and not state_done:
            errors.append(f"{path}: label {DONE_LABEL!r} requires state 'done'")

        if issue_id is not None:
            if ISSUE_PLACEHOLDER.fullmatch(issue_id) is not None:
                if strict:
                    errors.append(
                        f"{path}.id: placeholder {issue_id!r} is not numbered; "
                        "scripts/assign_ids.py --apply numbers it at merge"
                    )
            elif ISSUE_ID.fullmatch(issue_id) is None:
                errors.append(
                    f"{path}.id: expected SCP- followed by at least three digits, or SCP-NEW-<label>"
                )
        if issue_id in issue_records:
            errors.append(f"{path}.id: duplicate issue id {issue_id!r}")
        elif issue_id is not None:
            issue_records[issue_id] = (milestone, issue_labels, dependencies)

    known_issue_ids = set(issue_records)
    graph: dict[str, list[str]] = {}
    for issue_id, (milestone, issue_labels, dependencies) in issue_records.items():
        if milestone is not None and milestone not in milestone_names:
            errors.append(f"{issue_id}: unknown milestone {milestone!r}")
        for label in issue_labels:
            if label not in label_names:
                errors.append(f"{issue_id}: unknown label {label!r}")
        for dependency in dependencies:
            if dependency not in known_issue_ids:
                errors.append(f"{issue_id}: unknown dependency {dependency!r}")
        graph[issue_id] = [dependency for dependency in dependencies if dependency in known_issue_ids]

    visiting: set[str] = set()
    visited: set[str] = set()
    reported_cycles: set[tuple[str, ...]] = set()

    def visit(node: str, path: list[str]) -> None:
        if node in visiting:
            cycle_start = path.index(node)
            cycle = tuple(path[cycle_start:] + [node])
            if cycle not in reported_cycles:
                errors.append("Dependency cycle: " + " -> ".join(cycle))
                reported_cycles.add(cycle)
            return
        if node in visited:
            return
        visiting.add(node)
        for dependency in graph[node]:
            visit(dependency, [*path, node])
        visiting.remove(node)
        visited.add(node)

    for issue_id in graph:
        visit(issue_id, [])

    return errors


def load_validated_backlog(path: Path = BACKLOG_PATH, *, strict: bool = False) -> dict[str, object]:
    """Load backlog JSON and raise one actionable error for invalid input."""
    try:
        data: object = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_unique_json_object
        )
    except (OSError, json.JSONDecodeError, DuplicateJsonKeyError) as error:
        raise BacklogValidationError([f"{path}: {error}"]) from error
    errors = validate_backlog_data(data, strict=strict)
    if errors:
        raise BacklogValidationError(errors)
    assert isinstance(data, dict)
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="also reject SCP-NEW-<label> placeholder ids, which scripts/assign_ids.py numbers at merge",
    )
    arguments = parser.parse_args(argv)
    try:
        data = load_validated_backlog(strict=arguments.strict)
    except BacklogValidationError as error:
        print("Backlog validation failed:")
        for message in error.errors:
            print("-", message)
        return 1

    issues = data["issues"]
    milestones = data["milestones"]
    labels = data["labels"]
    assert isinstance(issues, list)
    assert isinstance(milestones, list)
    assert isinstance(labels, list)
    print(f"Backlog valid: {len(issues)} issues, {len(milestones)} milestones, {len(labels)} labels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
