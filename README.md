# rail

Per-feature Git worktrees or Jujutsu workspaces with isolated ports, env files, and hooks.

`rail` lets you work on multiple features of the same app at the same time
without stepping on yourself. Each feature gets its own worktree/workspace,
its own branch or bookmark, its own range of ports, its own generated `.env`,
and runs your project's setup and cleanup scripts on the way in and out.

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
rail up my-feature --skip-setup # create without running setup script
rail status              # lists active worktrees with branch, ports, dirty state, PR
rail down my-feature     # removes the worktree and frees its port slot
rail down --prune        # also deletes the feature branch/bookmark
```

For Jujutsu projects, initialize with `rail init --vcs jj`. New feature
workspaces default to `main@origin` as their parent and use JJ bookmarks for
feature refs.

Inside a feature tree the feature name is auto-detected, so `rail down` and
`rail run <name>` work without arguments.

## Concepts

**Worktrees and workspaces.** One tree per feature, created at
`<root>/trees/<feature>` by default. Git projects use branches; JJ projects use
workspaces plus bookmarks. Slash-separated feature names are supported and
normalized for directory names, so `rail up feature/blah` creates
`trees/feature+blah` while keeping the branch/bookmark name as `feature/blah`.
The directory and branch/bookmark prefix are configurable in `.rail/config.yaml`;
omit `worktrees.branch_prefix` or set it to `""` to use feature names directly.

**Port slots.** Each feature is assigned a slot index, not a fixed port.
Actual ports are derived as `base + index * per_feature`, so changing
`port.base` or `port.per_feature` shifts every feature's ports without
touching the allocations file. Only the slot index is persisted (in
`.rail/feature_allocations.json`, gitignored).

**Setup and cleanup.** `rail up` runs the configured setup script after tree
creation and env-file generation. If setup fails, rail rolls back the feature
tree and feature allocation before surfacing the setup error. Use
`rail up <feature> --skip-setup` to skip setup for that tree; rail records that
choice and skips the cleanup script on `rail down`. Cleanup script failures are
reported as warnings and do not block removing the feature tree.

**Env files.** Templated from a source file you point at (e.g.
`.env.example`). Keys listed under `replace:` get `${RAIL_PORT_N}`
substitution; keys listed under `secrets:` are filled from secret storage.
Everything else passes through unchanged.

**Hooks and commands.** `hooks` fire after `up`, `down`, or `run` completes.
`commands` are user-defined entries you invoke as `rail run <name>`; they
run with `RAIL_PROJECT`, `RAIL_FEATURE`, `RAIL_FEATURE_DIR`, and
`RAIL_PORT_1..N` in scope.

**Init and ignore rules.** `rail init` can be run on a new or existing rail
project. It creates missing files, repairs incomplete config, preserves valid
existing choices, and updates managed rail ignore entries. Use
`setup.track_rail: true` to track shared `.rail/config.yaml` and scripts while
ignoring only local files, or `setup.track_rail: false` to ignore the whole
`.rail/` directory. `setup.ignore_destination` controls whether those rules go
to `.gitignore` or `.git/info/exclude`.

**Pruning refs.** `rail down --prune` removes the feature tree, frees its port
slot, and deletes the matching feature ref. In Git projects this deletes the
local branch; in JJ projects this deletes the bookmark.

## Configuration

`rail init` writes `.rail/config.yaml`. The top-level structure is:

```yaml
name: your-project

vcs: git                 # git | jj
forge: github            # github | gitlab | none
default_parent: main     # git example: main; jj example: main@origin
auto_refresh: true

setup:
  track_rail: true       # true tracks shared .rail config/scripts
  ignore_destination: gitignore # gitignore | exclude

worktrees:
  dir: trees             # relative, absolute, and ~/... paths are supported
  branch_prefix: feature/ # optional; omit or set "" for no prefix

port:
  base: 3000
  per_feature: 2
  max: 100

scripts:
  setup: scripts/setup.sh
  cleanup: scripts/cleanup.sh

commands:
  - name: dev
    command: npm run dev
    description: Start development server
    scope: feature       # feature | project

env_files:
  - path: .
    source: .env.example
    dest: .env
    replace:
      PORT: "${RAIL_PORT_1}"

hooks:
  - event: up            # up | down | run
    command: echo "Ready!"
```

The key blocks are:

- `vcs` — `git` or `jj`
- `forge` — `github`, `gitlab`, or `none`
- `default_parent` — parent ref used by `rail up` when creating new feature trees
- `auto_refresh` — whether `rail up` refreshes the parent before creation
- `setup.track_rail` — whether shared `.rail` config and scripts are intended to be tracked
- `setup.ignore_destination` — `gitignore` or `exclude`
- `worktrees.dir` — where feature trees are created; relative, absolute, and `~/...` paths are supported
- `worktrees.branch_prefix` — optional branch/bookmark prefix; omit or set to `""` for no prefix
- `port` — slot-based port allocation settings; only feature slot indexes are persisted
- `scripts` — setup and cleanup scripts, resolved relative to `.rail/`
- `commands` — named commands for `rail run <name>`; `feature` scope runs in a feature tree, `project` scope runs at the repo root
- `env_files` — template-based env file generation with `replace` values and optional secrets
- `hooks` — commands that run after `up`, `down`, or `run`

## Commands

- `rail init` — Initialize or repair a rail project with boilerplate config and scripts
- `rail up <feature> [--skip-setup]` — Create a new feature tree with port allocation and optional env setup
- `rail down [feature] [--prune]` — Remove a feature tree, deallocate ports, and optionally delete its branch/bookmark
- `rail status` — Show all active feature trees with branch/bookmark, port, and dirty state
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
