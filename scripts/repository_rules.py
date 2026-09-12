#!/usr/bin/env python3
"""Pure repository-policy checks shared by validators and their tests."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
import re

import yaml
from yaml.nodes import MappingNode, Node, ScalarNode, SequenceNode

# A placeholder id's label: lowercase letters and digits in hyphen-separated
# runs. `--` never occurs inside one, so it ends a heading anchor unambiguously.
PLACEHOLDER_LABEL = r"[a-z0-9]+(?:-[a-z0-9]+)*"
DECISION_PREFIX = re.compile(r" {0,3}###[ \t]+D-")
# `D-nnn`, or `D-NEW-<label>` until scripts/assign_ids.py numbers it at merge.
DECISION_HEADING = re.compile(
    rf" {{0,3}}###[ \t]+D-(?:([0-9]{{3}})|NEW-({PLACEHOLDER_LABEL})) — (.*)"
)
FULL_COMMIT_SHA = re.compile(r"[0-9a-f]{40}")
FULL_DOCKER_DIGEST = re.compile(r"docker://.+@sha256:[0-9a-f]{64}")


@dataclass(frozen=True)
class ActionUse:
    reference: str
    line_number: int


def decision_heading_errors(text: str, source: str, *, strict: bool = False) -> list[str]:
    """Return malformed or duplicate decision-heading errors, and with `strict` one per placeholder."""
    errors: list[str] = []
    seen: dict[str, int] = {}
    for line_number, line in enumerate(text.removeprefix("\ufeff").splitlines(), start=1):
        if DECISION_PREFIX.match(line) is None:
            continue
        match = DECISION_HEADING.fullmatch(line)
        if match is None or not match.group(3).strip():
            errors.append(f"Invalid decision heading at {source}:{line_number}: {line!r}")
            continue
        number, label = match.group(1), match.group(2)
        decision_id = f"D-{number}" if label is None else f"D-NEW-{label}"
        kind = "decision ID" if label is None else "decision placeholder"
        if decision_id in seen:
            errors.append(
                f"Duplicate {kind} {decision_id} at "
                f"{source}:{seen[decision_id]} and {source}:{line_number}"
            )
        else:
            seen[decision_id] = line_number
        if strict and label is not None:
            errors.append(
                f"Decision placeholder {decision_id} at {source}:{line_number} is not numbered; "
                "scripts/assign_ids.py --apply numbers it at merge"
            )
    return errors


def decision_register_errors(path: Path, source: str, *, strict: bool = False) -> list[str]:
    """Read and validate a decision register, including the missing-file case."""
    if not path.exists():
        return [f"Missing {source}"]
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        return [f"Could not read {source}: {error}"]
    return decision_heading_errors(text, source, strict=strict)


def _action_uses(text: str, source: str) -> tuple[list[ActionUse], list[str]]:
    uses: list[ActionUse] = []
    try:
        document = yaml.compose(text, Loader=yaml.SafeLoader)
    except yaml.YAMLError as error:
        return [], [f"Invalid YAML in {source}: {error}"]
    if document is None:
        return uses, []

    def visit(node: Node) -> None:
        if isinstance(node, MappingNode):
            for key, value in node.value:
                if isinstance(key, ScalarNode) and key.value == "uses":
                    if isinstance(value, ScalarNode):
                        uses.append(ActionUse(value.value.strip(), value.start_mark.line + 1))
                    else:
                        parse_errors.append(
                            f"Invalid Action reference at {source}:{value.start_mark.line + 1}: "
                            "uses must be a string"
                        )
                visit(value)
        elif isinstance(node, SequenceNode):
            for item in node.value:
                visit(item)

    parse_errors: list[str] = []
    visit(document)
    return uses, parse_errors


def _action_use_pin_errors(action_use: ActionUse, source: str) -> list[str]:
    reference = action_use.reference
    line_number = action_use.line_number
    if reference.startswith("./"):
        return []
    if reference.startswith("docker://"):
        if FULL_DOCKER_DIGEST.fullmatch(reference) is None:
            return [
                f"Unpinned Docker Action at {source}:{line_number}: {reference!r}; "
                "use a sha256 digest"
            ]
        return []
    action, separator, revision = reference.rpartition("@")
    if not action or not separator or FULL_COMMIT_SHA.fullmatch(revision) is None:
        return [
            f"Unpinned external Action at {source}:{line_number}: {reference!r}; "
            "use a full 40-character commit SHA"
        ]
    return []


def workflow_action_pin_errors(text: str, source: str) -> list[str]:
    """Require every non-local GitHub Actions reference to use an immutable SHA."""
    action_uses, errors = _action_uses(text, source)
    for action_use in action_uses:
        errors.extend(_action_use_pin_errors(action_use, source))
    return errors


def repository_action_pin_errors(root: Path, workflows: Iterable[Path]) -> list[str]:
    """Validate workflow pins and recursively inspect every referenced local Action."""
    errors: list[str] = []
    root = root.resolve()
    pending = [path.resolve() for path in workflows]
    visited: set[Path] = set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        try:
            source = path.relative_to(root).as_posix()
        except ValueError:
            errors.append(f"Local Action path escapes repository: {path}")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as error:
            errors.append(f"Could not read Action definition {source}: {error}")
            continue

        action_uses, parse_errors = _action_uses(text, source)
        errors.extend(parse_errors)
        for action_use in action_uses:
            errors.extend(_action_use_pin_errors(action_use, source))
            if not action_use.reference.startswith("./"):
                continue
            local_path = (root / action_use.reference[2:]).resolve()
            try:
                local_path.relative_to(root)
            except ValueError:
                errors.append(
                    f"Local Action at {source}:{action_use.line_number} escapes repository: "
                    f"{action_use.reference!r}"
                )
                continue
            if local_path.is_file():
                pending.append(local_path)
                continue
            manifests = [
                candidate
                for candidate in (local_path / "action.yml", local_path / "action.yaml")
                if candidate.is_file()
            ]
            if len(manifests) != 1:
                errors.append(
                    f"Local Action at {source}:{action_use.line_number} must resolve to exactly "
                    f"one action.yml or action.yaml: {action_use.reference!r}"
                )
                continue
            pending.append(manifests[0])
    return errors
