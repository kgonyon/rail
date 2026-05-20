# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `bun run dev <subcommand>` — run the CLI from source (e.g. `bun run dev status`)
- `bun test` — run the full test suite (Bun test runner)
- `bun test src/lib/git.test.ts` — run a single test file
- `bun test --test-name-pattern "parsePorcelainStatusBreakdown"` — filter by test name
- `bun run typecheck` — `tsc --noEmit` (no emit; types only)
- `bun run build` — compile a standalone binary to `dist/rail` via `bun build --compile --minify`
- `bun run install:local` — build and symlink `dist/rail` into `~/.bun/bin/rail`

There is no linter; type safety is enforced by `tsc --noEmit` plus `strict: true` in `tsconfig.json`.

## Architecture

`rail` is a CLI for managing per-feature **git worktrees** with isolated port allocations, env files, scripts, and hooks. Each subcommand lives in `src/commands/<name>.ts` (citty `defineCommand`) and is wired into `src/cli.ts` via dynamic imports. Shared logic lives under `src/lib/`. `consola` is the only logger — `cli.ts` overrides `console.error` so citty's raw error output gets reformatted as a clean `consola.error`.

### Project layout (the `.rail/` directory)

A rail project is any git repo with a `.rail/config.yaml`. The full layout:

- `.rail/config.yaml` — committed config (`RailConfig` in `src/types/config.ts`)
- `.rail/local.yaml` — gitignored per-developer overrides; deep-merged onto `config.yaml` in `loadConfig()`
- `.rail/port_allocations.json` — gitignored persistent map of `feature → { index }`
- `.rail/scripts/setup.sh`, `.rail/scripts/cleanup.sh` — boilerplate written by `rail init`
- `~/.config/rail/config.yaml` — user-global hooks file, merged in by `loadAllHooks()`

Commands resolve the project root with `getProjectRoot()` (in `src/lib/paths.ts`), which calls `getGitRoot()` and **strips a `/worktrees/<name>` suffix from `git rev-parse --git-common-dir`**. This is what lets `rail status` / `rail down` / `rail run` work from inside a feature worktree and still find the main repo's `.rail/` directory.

### Worktrees

Feature worktrees live at `<root>/<config.worktrees.dir>/<feature>` on branch `<config.worktrees.branch_prefix><feature>`. `rail up` creates them via `git worktree add`, reusing an existing branch if it already exists. `rail down` removes via `git worktree remove --force`. `resolveFeature()` in `src/lib/detect.ts` auto-detects the feature name from `process.cwd()` when the user omits it — it looks for `/<treesDir>/<feature>/` in the path.

### Port allocation

Slot-based, not per-port. `allocatePorts()` finds the lowest unused integer `index` and stores `{ feature: { index } }` in `port_allocations.json`. Actual ports are derived on demand: `getPortsForFeature(portConfig, index)` returns `[base + index*per_feature, ..., base + index*per_feature + per_feature - 1]`. Slots are bounded by `max / per_feature`. This means **port numbers are never persisted** — only the slot index — so changing `port.base` or `port.per_feature` shifts every existing feature's ports without touching the allocations file.

### ScriptContext and RAIL_* env vars

Setup scripts, cleanup scripts, configured commands (`rail run`), and hooks all run through `runScript()` / `runCommand()` in `src/lib/script.ts`. They get the same env injection: `RAIL_PROJECT`, `RAIL_PROJECT_DIR`, `RAIL_FEATURE`, `RAIL_FEATURE_DIR`, `RAIL_PORT` (alias for port 1), and `RAIL_PORT_1..N`. `runScript()` enforces that the resolved script path stays under `.rail/` to prevent path-escape via config.

### Hooks vs commands vs scripts

Three overlapping mechanisms — keep them straight:

- **`scripts.setup` / `scripts.cleanup`** — single shell scripts that run during `rail up` / `rail down`. Path is relative to `.rail/`. One per project.
- **`hooks`** — list of `{ event: 'up'|'down'|'run', command }` that fire after the matching command completes. Loaded from `config.yaml`, `local.yaml`, and `~/.config/rail/config.yaml` and concatenated.
- **`commands`** — user-defined entries invoked as `rail run <name>`. Each has a `scope` of `feature` (default; runs inside a worktree, requires feature context) or `project` (runs at repo root, no feature env vars). Anything after `--` is shell-escaped and appended to the command.

A command listed as a relative path (contains `/` or ends in `.sh`) is resolved against `.rail/`; otherwise it's passed straight to `sh -c`.

### Env-file generation (`rail up`)

`generateEnvFiles()` in `src/lib/env.ts` reads each `env_files[].source` template, then for every `KEY=value` line: if `KEY` is in `secrets`, the value is replaced with the secret; if `KEY` is in `replace`, the configured template is substituted with `${RAIL_PORT_N}` interpolation. Lines that aren't `KEY=value` pass through unchanged.

### Status command and `gh` integration

`rail status` parallelizes per-worktree stats with a worker pool (`STATS_CONCURRENCY = 8`). It calls `gh pr list` to attach open-PR URLs, but only if `isGhAvailable()` succeeds — that probe is **cached at module level** in `git.ts`, so tests that toggle gh availability must call `__resetGhAvailableCache()`. PR URLs are validated (https-only, no control chars, ≤2048 chars, ≤50 PRs) and rendered as OSC 8 hyperlinks when stdout is a TTY. `RAIL_HYPERLINKS=always|never` overrides detection.

### Shell helpers and ref-name validation

`src/lib/shell.ts` exposes `gitExec` and `ghExec`. Anything interpolated into a git command (branch names, default branch) goes through `isSafeRefName()` — the regex allows only `[A-Za-z0-9._\-/]`, max 255 chars. This is defense-in-depth on top of Bun's `$` template tag; if you add a new git call that takes a ref from config or `gh` output, validate first.

## Conventions

- Tests are colocated as `*.test.ts` next to the module. `*.integration.test.ts` files hit the real filesystem / real subprocesses and are slower; they're picked up by the same `bun test` run.
- Internal exports are tagged `/** @internal */` so they're discoverable but signal "test-only / not part of the public surface."
- Imports are explicit per-file — there are no barrel `index.ts` re-exports (per the parent `Code/CLAUDE.md`).
- `consola` for all user output. Don't `console.log` outside of `status.ts`'s formatted block printing.
