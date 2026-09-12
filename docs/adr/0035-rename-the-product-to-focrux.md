# ADR-0035: The product is Focrux everywhere

- Status: accepted

## Context

A person meets the product in the desktop, the terminal, the local store and the code. One name across all of them means nothing needs translating between them ([D-098](../11-open-decisions.md)).

## Decision

- The package scope is `@focrux/*`.
- The binary is `focrux`, and its bundle is `bin/focrux.mjs`.
- The local store is `.focrux/` in a repository and `~/.focrux/` on a machine.
- Environment variables are `FOCRUX_*`.
- Worktree, bundle and hook names carry the `focrux-` prefix.
- The reviewer's prompt delimiters are `<focrux:…>`.
- New tickets take the key `FCX`.
- New branches take the prefix `fcx/`, and an `AYO` ticket's keep `ayo/`; a ticket or run that already has a branch keeps it.

Recorded identifiers keep their bytes: existing `AYO` ticket keys and `ayo/` branches, `SCP-`, `D-` and ADR numbers and filenames, and the records in a ticket store.

## Consequences

Nothing reads or migrates a machine's existing `~/.ayaori` directory.

## Alternatives considered

Keeping the old executable, package and store names under a new display name.
