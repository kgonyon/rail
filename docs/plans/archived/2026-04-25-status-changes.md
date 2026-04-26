# Spec: Richer worktree status — uncommitted, untracked, ahead, PRs

**Date:** 2026-04-25
**Status:** shipped

## Scope & Intent

### Problem / Why
Today `rail status` shows only `clean` or `N changed  +X -Y` for each feature worktree. The `clean` signal is misleading: a branch with all changes committed and a PR open shows up as `clean`, hiding genuinely in-flight work. Users lose visibility into committed-but-unmerged commits and open pull requests, which is exactly the state worktrees spend most of their time in.

### Goal
Surface four distinct kinds of in-flight state per worktree in `rail status`: (1) staged/unstaged file counts, (2) untracked file count, (3) commits ahead of the default branch, and (4) number of open PRs sourced from the branch. Render each line only when non-zero; show `clean` only when all four categories are zero.

### In Scope
- Extending `WorktreeStats` with separate counts for staged, unstaged, untracked, and `commitsAhead`.
- Adding a `gh` CLI wrapper to query open PRs by branch.
- Reworking `formatStats` / `printFeatureStatus` to render the multi-line itemized layout.
- Parallelizing stat collection across worktrees.
- Updating unit tests for parsing and formatting.

### Out of Scope / Non-Goals
- ANSI color output (deferred, consistent with prior status spec).
- A `--json` or `--compact` flag.
- Auto-fetching from origin during `status` (kept read-only / offline).
- PR state beyond "open with this branch as HEAD" (no draft/merged/closed counts).
- Caching gh responses across invocations.
- Telemetry / observability instrumentation.

## Requirements

### Functional Requirements
- **FR-1:** When a worktree has staged or unstaged changes, status shows a "files changed" line that breaks the count down by staged vs. unstaged.
- **FR-2:** Status preserves existing `+X -Y` insertion/deletion totals next to the file-changed line.
- **FR-3:** When a worktree has untracked files, status shows an "untracked files" line with a count.
- **FR-4:** When a worktree has commits not present on `origin/<default-branch>`, status shows a "commits ahead of <default>" line with a count.
- **FR-5:** When the worktree's branch IS the default branch, the "commits ahead" line is omitted entirely (the count would always be zero and is noise).
- **FR-6:** When `gh` is available and authenticated and one or more open PRs have this branch as HEAD, status shows an "open PR" line with a count.
- **FR-7:** When all four categories are zero, status shows `clean` (matching today's behavior).
- **FR-8:** Lines only appear when their count is non-zero (or `?` per ERR-1/ERR-2).
- **FR-9:** Stat collection across worktrees is parallel (`Promise.all`).
- **FR-10:** Default branch is detected via `git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main`.

### Non-Functional Requirements
- **Performance:** `rail status` should stay snappy for typical 5–20 worktrees. With parallelization, total wall time ≈ slowest single worktree's stat fetch (~few hundred ms with `gh` involved).
- **Security / Privacy:** N/A — local CLI, no new data egress beyond shell-invoked `git` and `gh`. No new secrets handling.
- **Reliability:** Per-call git/gh failures degrade to `?` for that line; one failure must not abort the whole `status` run or other worktrees.
- **Scalability:** N/A — bounded by user's worktree count (single-digit to low double-digit).
- **Maintainability:** New parsing / formatting code follows the existing pure-function pattern in `src/lib/git.ts` (testable without invoking git). No new dependencies.

## User Stories

- **US-1:** As a developer with all changes committed and a PR open, I want `rail status` to show that I have committed work and an open PR, so I don't mistake my branch for `clean`. → AC: UI-3, UI-4
- **US-2:** As a developer mid-edit, I want to see at a glance how many files I've staged vs. left unstaged. → AC: UI-1
- **US-3:** As a developer who just `git add`-ed new files, I want untracked files counted separately from tracked changes. → AC: UI-2
- **US-4:** As a developer with a worktree on `main` itself, I don't want a noisy "0 commits ahead of main" line. → AC: UI-5
- **US-5:** As a developer without `gh` installed/authed, I want `rail status` to still work and tell me once that PR counts are unavailable. → AC: ERR-2
- **US-6:** As a developer in a clean worktree, I want `rail status` to keep saying `clean` so I can tell at a glance there's nothing to do. → AC: UI-6

## Contracts

### API / Interface Contracts
N/A — no public API surface; internal CLI only.

### Data / Schema Contracts

`WorktreeStats` interface in `src/lib/git.ts` extended:

```typescript
interface WorktreeStats {
  fileCount: number;        // existing — staged + unstaged + untracked
  stagedFiles: number;      // new
  unstagedFiles: number;    // new
  untrackedFiles: number;   // new
  insertions: number;       // existing
  deletions: number;        // existing
  isDirty: boolean;         // existing — fileCount > 0
  commitsAhead: number;     // new — vs origin/<default-branch>; 0 if branch == default
  openPrCount: number | null; // new — null when gh unavailable/unauthed; -1 sentinel for per-call failure (rendered as '?')
}
```

`isDirty` continues to mean "any tracked or untracked file change present" — `refresh.ts` callers keep working unchanged.

### Event / Message Contracts
N/A — no events.

## Backwards Compatibility

- **Breaking changes:** The terminal output of `rail status` changes from a single `Status: …` line to a multi-line `Status:` block (with indented sub-lines per category). The shape of `WorktreeStats` is extended; existing fields preserved; existing callers (only `refresh.ts`, which reads `isDirty`) continue to work.
- **Migration / rollout plan:** None needed. Internal pre-1.0 CLI; no scripts or downstream tools depend on output shape. Note in PR description.
- **Deprecation path:** N/A — the old `formatStats` shape is replaced cleanly; no deprecated path retained.
- **Feature flag / kill switch:** N/A — the change is the feature.

## Test Strategy

- **Levels:**
  - Unit tests for new pure parsing functions (`parsePorcelainStatusBreakdown`, `parseRevListCount`) in `src/lib/git.test.ts`.
  - Unit tests for new pure formatter logic in `src/commands/status.test.ts` covering: clean, only staged, only untracked, only ahead, only PR, all four categories, gh unavailable (omit line), per-call failure (`?` rendered), worktree on default branch (no ahead line).
  - Mocked `gitExec` / new `ghExec` handlers using the existing `mock.module('./shell', …)` pattern.
- **Fixtures / seed data:** Inline string fixtures of `git status --porcelain` and `git rev-list --count` and `gh pr list --json` outputs in test files. No on-disk fixtures.
- **Manual QA checklist:**
  - In a worktree with staged + unstaged + untracked changes, run `rail status` and confirm three separate lines.
  - In a worktree where everything is committed but unmerged, confirm `commits ahead` line appears and `clean` does not.
  - With a PR open against the branch, confirm "1 open PR" line.
  - Uninstall / log out of `gh` and confirm one-time warning + status still completes.
- **What is intentionally NOT tested:**
  - Live `gh` API responses (always mocked).
  - Live network / fetch behavior (we never fetch from `status`).
  - Concurrency timing (use `Promise.all`; no race-condition tests).

## Observability

N/A — internal-only CLI tool, no telemetry surface. (Per Non-Functional Requirements waiver.)

## Technical Specification

- **Stack:** TypeScript on Bun runtime, `citty` for CLI, `consola` for messages, `bun:test` for tests. Current architecture per existing repo.
- **New Dependencies:** None. `gh` is invoked as an external binary via Bun's `$` template (same pattern as `git`).

## UI / Mockups

```
  feature-x
    Branch: feature/x
    Ports:  3000-3001
    Status:
      3 files changed (2 staged, 1 unstaged)  +42 -7
      2 untracked files
      4 commits ahead of main
      1 open PR

  bugfix-y
    Branch: feature/bugfix-y
    Ports:  3010-3011
    Status: clean

  release-prep
    Branch: feature/release-prep
    Ports:  3020-3021
    Status:
      ? open PRs
```

(The `?` form appears when an individual git/gh call fails for that worktree; the warning for missing `gh` itself is printed once at the top of the run.)

## Key Decisions

- **Layout:** Itemized multi-line, only non-zero categories rendered. `clean` retained when nothing to show.
- **`gh` fallback:** One-time warning printed at the top of the `status` run when `gh` is missing or unauthenticated; PR lines are then omitted for all worktrees in that run.
- **Per-call failure rendering:** `?` placeholder (e.g., `? open PRs`, `? commits ahead`) when a specific git/gh subprocess fails, so the user sees that something was attempted and didn't succeed.
- **Ahead semantics:** `git rev-list --count origin/<default>..HEAD`. Default branch via `git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`.
- **PR scope:** Open PRs with this branch as HEAD only — `gh pr list --head <branch> --state open --json number`.
- **No fetch:** `status` is read-only / offline. Users run `git fetch` or `rail refresh` for fresh remote state.
- **Self-branch suppression:** `commitsAhead` line omitted when the worktree's branch equals the resolved default branch.
- **Concurrency:** `Promise.all` over worktrees so total time is bounded by the slowest worktree's stat fetch.
- **Insertions/deletions retained:** `+X -Y` continues to display alongside file counts.

## Deferred Decisions

- **ANSI color output:** Punted, consistent with the prior `status-git-stats` spec.
- **`--json` machine-readable output:** Punted; revisit if tooling integrations request it.
- **Caching `gh` results:** Punted; per-run cost is acceptable given parallelism.
- **Draft vs ready PR distinction:** Punted; first-class count is sufficient.

## Open Questions

(none — Definition of Ready met)

## Acceptance Criteria

### UI

- [ ] **UI-1:** With both staged and unstaged tracked changes present, status renders `N files changed (S staged, U unstaged)  +X -Y`. (proves US-2)
- [ ] **UI-2:** With untracked files present, status renders `N untracked files` on its own line. (proves US-3)
- [ ] **UI-3:** With commits not on `origin/<default>` and no uncommitted work, status renders `N commits ahead of <default>` and does NOT render `clean`. (proves US-1)
- [ ] **UI-4:** With one open PR sourced from the branch, status renders `1 open PR`. With ≥2, renders `N open PRs`. (proves US-1)
- [ ] **UI-5:** When the worktree's branch equals the resolved default branch, the `commits ahead` line is omitted regardless of count. (proves US-4)
- [ ] **UI-6:** When all categories are zero, status renders the single token `clean` (matches today's behavior). (proves US-6)

### Database

N/A — no persistence.

### Error Handling

- [ ] **ERR-1:** When an individual git/gh subprocess for a worktree fails, the affected line is rendered with `?` (e.g., `? commits ahead of main`) and other lines for that worktree still render normally.
- [ ] **ERR-2:** When `gh` is missing from PATH or `gh auth status` fails, a single `consola.warn` is emitted once at the top of the `rail status` run, and PR lines are omitted for all worktrees that run. (proves US-5)
- [ ] **ERR-3:** A failure in any single worktree's stat collection does not prevent other worktrees from rendering.

### Observability

N/A — waived.

---

## Phases

### Phase 1: Extend git stats

**Status:** completed
**Dependencies:** None

#### Summary

Broaden `WorktreeStats` with `stagedFiles`, `unstagedFiles`, `untrackedFiles`, and `commitsAhead`. Add a parser that bins porcelain XY codes into staged / unstaged / untracked. Add a `commitsAhead(treePath, defaultBranch, branch)` helper that runs `git rev-list --count origin/<default>..HEAD` and returns 0 when `branch == default`. Add a default-branch resolver. All new logic exposed as pure functions for unit tests.

#### Tasks

- [ ] Extend the `WorktreeStats` interface in `src/lib/git.ts` with `stagedFiles`, `unstagedFiles`, `untrackedFiles`, `commitsAhead`. Keep `fileCount` as the sum so existing callers work.
- [ ] Add `parsePorcelainStatusBreakdown(output)` returning `{ staged, unstaged, untracked }`. Rules: `??` → untracked; column 1 in `[MADRCU]` (and not `?`) → staged; column 2 in `[MADRCU]` → unstaged; a single file may count toward both staged and unstaged. Skip `!!` (ignored). Tracked file count for `fileCount` = unique paths with any non-`!!` status.
- [ ] Add `parseRevListCount(output)` (single-line numeric output of `git rev-list --count`).
- [ ] Add `getDefaultBranch(root)` using `git symbolic-ref refs/remotes/origin/HEAD`, parse the trailing segment, fallback `'main'` on failure.
- [ ] Update `getWorktreeStats` to populate the new fields. When `branch === defaultBranch`, set `commitsAhead = 0` without invoking `git rev-list`. On `git rev-list` failure, set `commitsAhead = -1` (sentinel for `?`).
- [ ] Add unit tests in `src/lib/git.test.ts` covering: every XY code into the right bucket, files appearing in both staged and unstaged, `parseRevListCount` happy/edge cases, default branch resolution success and fallback, branch-equals-default short-circuit, rev-list failure → `-1`.

#### Testing

UI-1, UI-3, UI-5, ERR-1, ERR-3 are partially exercised here through unit tests on parsing and stat collection. Run: `bun test src/lib/git.test.ts`.

#### Files Changed

| File | Changes |
|------|---------|
| `src/lib/git.ts` | Extend `WorktreeStats`, add parsers, add `getDefaultBranch`, update `getWorktreeStats`. |
| `src/lib/git.test.ts` | Add tests for new parsers and stat extensions. |

#### Notes

- Keep all parsers pure (no `gitExec` calls inside).
- Use the established `mock.module('./shell', …)` pattern for `getWorktreeStats` tests.

---

### Phase 2: GitHub PR integration

**Status:** completed
**Dependencies:** Phase 1

#### Summary

Add a `ghExec(args)` wrapper mirroring `gitExec`, plus `getOpenPrCount(branch)` that calls `gh pr list --head <branch> --state open --json number` and returns the array length. Add a one-shot `isGhAvailable()` check that probes `gh auth status` once per invocation. Surface availability + per-call failure through new `WorktreeStats.openPrCount` (`null` for unavailable, `-1` sentinel for per-call failure, otherwise count). Plumb a `defaultBranch` and a `ghAvailable` flag through `getWorktreeStats` so the stat function can skip the gh call cleanly.

#### Tasks

- [ ] Add `ghExec(args)` to `src/lib/shell.ts` (no `-C` flag — `gh` works by being run from a git working tree, which our worktree paths satisfy).
- [ ] Add `isGhAvailable()` in `src/lib/git.ts` (or a new `src/lib/gh.ts`): runs `gh auth status` and returns boolean. Cache the result in module scope per process so repeated `getWorktreeStats` calls don't re-probe.
- [ ] Add `getOpenPrCount(treePath, branch)` returning a number. Internally invokes `gh pr list --head <branch> --state open --json number`, parses JSON, returns array length. Return `-1` on subprocess failure.
- [ ] Update `getWorktreeStats(treePath, options)` signature to accept `{ defaultBranch, branch, ghAvailable }`. When `ghAvailable === false`, set `openPrCount = null` without invoking gh.
- [ ] Update `printFeatureStatus` (caller in `src/commands/status.ts`) to pass these options in. Default-branch resolution happens once per `rail status` run, not per worktree.
- [ ] Add unit tests for `parseGhPrListJson` (length of array; empty array; malformed → throws or returns `-1`), and for `getOpenPrCount` returning `-1` on subprocess failure.

#### Testing

UI-4, ERR-2 are exercised here. Mocks for `ghExec` follow the existing `mock.module('./shell', …)` pattern (extend the mock to also export `ghExec`). Run: `bun test src/lib/git.test.ts`.

#### Files Changed

| File | Changes |
|------|---------|
| `src/lib/shell.ts` | Add `ghExec`. |
| `src/lib/git.ts` | Add `isGhAvailable`, `getOpenPrCount`; update `getWorktreeStats` signature. |
| `src/lib/git.test.ts` | Add tests for gh logic. |

#### Notes

- `isGhAvailable` is process-cached but should NOT be persisted across CLI invocations — each `rail status` re-probes once.
- `gh pr list` with `--json number` returns `[{"number": N}, …]`; we count entries, not parse numbers.

---

### Phase 3: Status display

**Status:** completed
**Dependencies:** Phase 2

#### Summary

Replace the single-line `formatStats` with a multi-line itemized formatter that renders only non-zero categories (`?` for sentinel `-1`, omitted for `null`). Update `printFeatureStatus` to print the multi-line `Status:` block. Add a one-time gh-unavailable warning at the top of the `rail status` run. Parallelize per-worktree stat collection via `Promise.all`.

#### Tasks

- [ ] Replace `formatStats(stats)` in `src/commands/status.ts` with a function that returns a `string[]` of lines (one per non-zero category) — caller decides how to render. When all categories are zero, return `['clean']`.
  - Line 1 (changes): `${stagedFiles + unstagedFiles} files changed (${stagedFiles} staged, ${unstagedFiles} unstaged)  +${insertions} -${deletions}` when `stagedFiles + unstagedFiles > 0`. Insertions/deletions block omitted when both are 0.
  - Line 2 (untracked): `${untrackedFiles} untracked file${untrackedFiles === 1 ? '' : 's'}` when `> 0`.
  - Line 3 (ahead): `${commitsAhead} commit${commitsAhead === 1 ? '' : 's'} ahead of ${defaultBranch}` when `commitsAhead > 0`. `? commits ahead of ${defaultBranch}` when `commitsAhead === -1`. Omitted when branch == default (already encoded as 0 from Phase 1).
  - Line 4 (PRs): `${openPrCount} open PR${openPrCount === 1 ? '' : 's'}` when `openPrCount > 0`. `? open PRs` when `-1`. Omitted when `null`.
- [ ] Update `printFeatureStatus` to render: if `lines.length === 1`, print `Status: ${lines[0]}` (preserves today's clean / single-line shape). Otherwise print `Status:` then each line indented further.
- [ ] In the `run()` function of `src/commands/status.ts`, resolve the default branch once and probe `isGhAvailable()` once. If `gh` unavailable, emit a single `consola.warn` ("gh CLI unavailable; PR counts will be skipped") before the per-worktree output.
- [ ] Replace the sequential `for (const wt of features)` printing with `Promise.all(features.map(...))` that collects stats concurrently, then prints sequentially in the original feature order to keep deterministic output.
- [ ] Update existing `formatStats` tests in `src/commands/status.test.ts` for the new return type and add tests for: only staged, only unstaged, both staged+unstaged, only untracked, only ahead, only PR, all four together, branch-equals-default (no ahead line), gh unavailable (no PR line), per-call `?` rendering for ahead and PR, clean case still returns `['clean']`.

#### Testing

UI-1, UI-2, UI-3, UI-4, UI-5, UI-6, ERR-1, ERR-2, ERR-3. Run: `bun test`.

#### Files Changed

| File | Changes |
|------|---------|
| `src/commands/status.ts` | New formatter, multi-line print, gh availability probe + warning, parallel collection. |
| `src/commands/status.test.ts` | Updated formatter tests + new cases. |

#### Notes

- Order of lines is fixed: changes → untracked → ahead → PR.
- Pluralization uses simple `=== 1` check — no i18n.
- The `?` rendering keeps the same line shape minus the count, so users can still see what the tool was attempting.
