#!/usr/bin/env python3
"""Reading a GitHub repository's name from a git remote.

Its own module, and stdlib only: the scripts that need it are not validators and
must not acquire the validators' dependencies to ask this one question.
"""
from __future__ import annotations

import re

# A GitHub remote in either form git writes: `git@github.com:owner/repo.git`,
# `ssh://git@github.com/owner/repo.git` or `https://github.com/owner/repo`.
GITHUB_REMOTE = re.compile(
    r"(?:git@github\.com:|ssh://git@github\.com/|https://github\.com/)"
    r"(?P<owner>[^/]+)/(?P<repository>[^/]+?)(?:\.git)?/?$"
)


def github_repository_from_remote(url: str) -> str:
    """`owner/repository` for a GitHub remote URL, so a script need not hardcode it."""
    match = GITHUB_REMOTE.match(url.strip())
    if match is None:
        raise ValueError(f"not a GitHub remote URL: {url.strip()!r}")
    return f"{match['owner']}/{match['repository']}"
