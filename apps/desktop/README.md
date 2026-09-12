# Focrux desktop

A local Electron application over the existing CLI, with a shared React interface and the supplied Focrux artwork. Native mode reads real repositories and records. The browser preview uses labelled sample data and cannot start coding agents.

## Run locally

From the repository root, run `./scripts/setup-local.mjs` (or `node scripts/setup-local.mjs` on Windows). It checks Node 22+/npm and Git, uses the repository's pinned pnpm without a global install, installs frozen dependencies, builds the production renderer/CLI and opens Electron. `--no-launch` builds without opening a window. See [Installing Focrux](../../docs/install.md) for provider installation and sign-in. This setup path needs no Vite server. Close an existing Focrux process before launching a rebuilt copy.

For development with live renderer updates:

Prerequisites: Node 22 or newer, pnpm 9.15.9, Git, and either or both subscription CLIs installed and logged in (`claude` / `codex login`). GitHub CLI authentication is needed only for GitHub operations. Login does not guarantee remaining quota.

```sh
pnpm install
pnpm desktop:dev
```

`desktop:dev` builds the CLI, starts Vite on 127.0.0.1:51859 and opens Electron. For a production renderer without a dev server:

```sh
pnpm desktop:build
pnpm desktop:start
```

For a browser-only design preview, run `pnpm desktop:preview`. Add `?empty` to inspect empty onboarding, or `?slow#new` to keep simulated drafting, compilation and completion states visible for eight seconds during visual QA. The native completion countdown remains three seconds. Native mode never falls back to sample records when a host request fails.

## Local package

```sh
pnpm desktop:package
```

The unsigned package is written beneath `apps/desktop/release` for the current host platform and architecture. It bundles the CLI, its guard hook and the pinned Node 22.22.0 binary supplied by the `node` development dependency. It does not depend on a Homebrew Node installation at runtime. Git, the provider CLIs and the repository's package manager remain machine prerequisites. Signing/notarization, installer distribution and Windows/Linux runtime qualification are separate release work.

## Test and understand the boundaries

```sh
pnpm desktop:build
pnpm --filter @focrux/desktop typecheck test lint
pnpm --filter @focrux/runner exec vitest run test/codex-admission.test.ts test/codex-rpc.test.ts
```

Host integration tests create disposable Git repositories and call the actual bundled CLI for admission, edit, inspect and approval. Coding execution in these tests is controlled. The screens and flows are described in [docs/15](../../docs/15-product-experience-and-onboarding.md).

The renderer uses `packages/ui`, shared assets and a closed Zod protocol. Only the host owns native dialogs, validated repository references and fixed CLI subprocesses. Settings is a pill in the rail — General, Usage, Connections — with Shortcuts and About one level under General. General's appearance choices set `data-theme`, `data-text-size` and `data-motion` on the document; the dark palette and the transitions.dev motion tokens and snippets live in `packages/ui` (`tokens.css`, `motion.css`, the latter pinned to an upstream commit named at its top). Usage sums the month's spend from each repository's `.focrux/state/*.attempts.json` and asks Codex's app-server for its plan windows; Claude Code reports none without an inference turn, and the page says so. Completed tickets stay on Home until archived by hand; `archived` is a profile preference, never a Ticket state. The away-from-keyboard hold uses Electron's power-save blocker only while a run or decision job is live. On macOS the native title bar is hidden; the page header is the top bar, beside the traffic lights and a sidebar toggle, and the fixed-width icon rail sits beneath it, hidden or restored from the toggle and remembered per browser profile. Each subscription account on Connections can be refreshed or signed in again; sign-in opens Terminal on the provider's fixed login command through `osascript` with argv only, and the desktop still never takes a credential. Every dropdown is the desktop's own listbox (`Dropdown` in `Screen.tsx`, the native select's interface over a `t-dropdown` menu), so the OS menu never appears. A contract that has never run — no attempt, no bundle, no pull request — can be deleted from its contract screen; the host removes the ticket's three files from `.focrux/tickets/` and nothing else, and refuses anything with evidence. Claude Code's catalog lists the model its `default` alias points at under that model's own name, marked default, so Opus is never hidden behind the alias. The app keeps its local profile/job journal in Electron's Focrux user-data directory; canonical tickets and evidence remain in each repository's `.focrux` store. Provider CLIs own credentials. Stop signals the command's process group; app restart marks unfinished jobs interrupted.

Model dropdowns use Claude Code's initialization catalog and Codex app-server's paginated [`model/list`](https://developers.openai.com/codex/app-server) metadata. Claude aliases are resolved to model IDs when the CLI provides them. Discovery runs in a temporary directory with repository instructions, hooks, tools and plugins disabled; Codex uses the same isolated credential-only home as execution. No inference turn is sent. The optional Anthropic API reviewer discovers models through `/v1/models` using the app's environment credential. Catalogs are validated, cached for five minutes in the shared query client and manually refreshable. A discovery failure never falls back to a guessed list or silently replaces a saved model. Availability and quota are still checked by the provider when a run starts.

Publication requires the checkbox on that run, and merging is your action on GitHub.
