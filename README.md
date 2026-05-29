# rail

Per-feature git worktrees with isolated ports, env files, and hooks.

`rail` lets you work on multiple feature branches of the same app at the same
time without stepping on yourself. Each feature gets its own git worktree on
its own branch, its own range of ports, its own generated `.env`, and runs
your project's setup and cleanup scripts on the way in and out.

## Install

### Homebrew

```sh
brew install kgonyon/tap/rail
```

Upgrade to the latest stable release:

```sh
rail upgrade
```

### From source

Requires [Bun](https://bun.sh).

```sh
git clone https://github.com/kgonyon/rail
cd rail
bun install
bun run install:local   # builds dist/rail and symlinks it into ~/.bun/bin/rail
```

## Quickstart

```sh
cd your-project          # any git repo
rail init                # writes .rail/config.yaml + setup/cleanup scripts
rail up my-feature       # creates a worktree at trees/my-feature, allocates ports
rail status              # lists active worktrees with branch, ports, dirty state, PR
rail down my-feature     # removes the worktree and frees its port slot
rail down --prune        # also deletes the feature branch/bookmark
```

Inside a feature worktree the feature name is auto-detected, so `rail down`
and `rail run <name>` work without arguments.

## Concepts

**Worktrees.** One worktree per feature, created at `<root>/trees/<feature>`
on branch `feature/<feature>` by default. Slash-separated feature names are
normalized for directory names, so `rail up feature/blah` creates
`trees/feature+blah` while keeping the branch/bookmark name as `feature/blah`.
The directory and branch prefix are configurable in `.rail/config.yaml`; omit
`worktrees.branch_prefix` or set it to `""` to use feature names directly.

**Port slots.** Each feature is assigned a slot index, not a fixed port.
Actual ports are derived as `base + index * per_feature`, so changing
`port.base` or `port.per_feature` shifts every feature's ports without
touching the allocations file. Only the slot index is persisted (in
`.rail/port_allocations.json`, gitignored).

**Env files.** Templated from a source file you point at (e.g.
`.env.example`). Keys listed under `replace:` get `${RAIL_PORT_N}`
substitution; keys listed under `secrets:` are filled from secret storage.
Everything else passes through unchanged.

**Hooks and commands.** `hooks` fire after `up`, `down`, or `run` completes.
`commands` are user-defined entries you invoke as `rail run <name>`; they
run with `RAIL_PROJECT`, `RAIL_FEATURE`, `RAIL_FEATURE_DIR`, and
`RAIL_PORT_1..N` in scope.

## Commands

- `rail init` — Initialize a new rail project with boilerplate config and scripts
- `rail up <feature>` — Create a new feature worktree with port allocation and env setup
- `rail down [feature] [--prune]` — Remove a feature worktree, deallocate ports, and optionally delete its branch/bookmark
- `rail status` — Show all active feature worktrees with branch, port, and dirty state
- `rail run <name>` — Run a configured command
- `rail refresh` — Pull latest changes from the default branch
- `rail upgrade` — Upgrade Homebrew installs or replace a manual binary with the latest release
- `rail -v`, `rail --version` — Print the current rail version

Run any command with `--help` for its flags.

## Releases

Pushing a stable tag like `v1.2.3` builds macOS/Linux release binaries, creates a GitHub release, and updates `kgonyon/homebrew-tap`. The release workflow needs a `HOMEBREW_TAP_GITHUB_TOKEN` secret with write access to that tap repo.

## Further reading

- [`CLAUDE.md`](./CLAUDE.md) — full architecture and configuration reference.
- [`LICENSE`](./LICENSE) — MIT.
