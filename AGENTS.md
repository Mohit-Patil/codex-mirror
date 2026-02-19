# AGENTS.md — codex-mirror

## Project Overview

codex-mirror is a local multi-account manager for the Codex CLI. It creates fully isolated clones of Codex on a single machine, each with its own runtime binary, HOME directory, auth state, and wrapper script. Unofficial community tool — not affiliated with OpenAI.

**Current state:** v0.1.5, Phase 1 (Codex-only). Phase 2 will add multi-provider support.

## Quick Reference

```bash
npm run check          # typecheck + test + build (run before every PR)
npm run test           # vitest run
npm run typecheck      # tsc -p tsconfig.test.json
npm run build          # tsc -p tsconfig.json → dist/
npm run dev            # tsx src/cli.ts (interactive dev)
```

Always run `npm run check` before committing. CI runs this on ubuntu + macos with Node 20 and 22.

## Architecture

```
src/cli.ts                  Entry point. No args → TUI; otherwise Commander.js CLI
src/types.ts                Core interfaces: CloneRecord, Registry, DoctorResult, RuntimeInfo, ClonePaths
src/core/
  clone-manager.ts          Orchestrator — transactional create/update/remove with rollback
  registry.ts               File-locked JSON registry (~/.codex-mirror/registry.json)
  runtime-cloner.ts         Detects system Codex, copies into clone runtime dir
  wrapper-manager.ts        Generates per-clone bash wrapper scripts in ~/.local/bin/
  launcher.ts               Executes Codex in isolated env (HOME, XDG_*)
  doctor.ts                 Health checks: runtime, wrapper, writability, auth status
  path-setup.ts             Manages PATH in shell RC files (bash/zsh/fish/sh)
  clone-name.ts             Clone name validation and sanitization
  context.ts                Resolves global config (CODEX_MIRROR_HOME, CODEX_MIRROR_BIN_DIR)
src/tui/
  index.ts                  TUI application loop and workflows (684 lines)
  menu.ts                   Custom raw-mode terminal renderer and prompts (614 lines)
src/utils/
  fs.ts                     Async filesystem helpers (ensureDir, copyDir, readJsonFile, etc.)
  process.ts                Subprocess execution with timeouts and capture
  logger.ts                 Simple logger (currently unused, reserved for future)
```

### Data Flow

User input → CLI/TUI → CloneManager → Registry + RuntimeCloner + WrapperManager → Filesystem

### Storage Layout

```
~/.codex-mirror/                    CODEX_MIRROR_HOME (default)
  registry.json                     Global clone registry (file-locked)
  clones/<name>/
    .codex-mirror/
      clone.json                    Clone metadata
      runtime/                      Pinned Codex binary or npm package
      home/                         Isolated HOME
        .codex/                     Codex config
        .config/ .local/share/ .cache/   XDG dirs
      logs/
~/.local/bin/<name>                 CODEX_MIRROR_BIN_DIR (wrapper scripts)
```

## Key Design Patterns

- **Transaction/Rollback**: All mutations (create/update/remove) track completed steps and roll back on failure. Never leave partial state.
- **File Locking**: Registry uses `.lock` files with 10s timeout, 60s stale detection, exponential backoff polling (40ms).
- **Atomic Writes**: Registry writes to `.tmp-<pid>-<uuid>` then renames (POSIX atomic).
- **Dependency Injection**: Core classes take dependencies via constructors for testability.
- **Path Confinement**: Wrapper paths are resolved and asserted to stay within binDir.
- **Input Validation**: Clone names reject path separators, `..`, Windows reserved names, max 64 chars.

## Code Conventions

- **Language**: TypeScript, strict mode, ES2022 target, NodeNext modules (ESM)
- **Formatting**: 2-space indent, UTF-8, LF line endings, trailing newline
- **Imports**: Use `.js` extensions in import paths (NodeNext resolution)
- **Async**: All filesystem and process operations are async/await using `node:fs/promises`
- **Error handling**: Specific error messages with context. Transactions include rollback info.
- **Naming**: camelCase for variables/functions, PascalCase for types/classes, kebab-case for filenames
- **Dependencies**: Keep production deps minimal (currently only 2: commander, @inquirer/prompts)
- **Commits**: Conventional Commits recommended (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`)

## Testing

- **Framework**: Vitest (`tests/**/*.test.ts`)
- **13 test files** covering all core modules, TUI, and CLI integration
- **Patterns used**:
  - Real temp directories via `mkdtemp()` with cleanup in `afterEach`
  - `vi.hoisted()` for module-level mocks
  - Fixture factories (`createCloneFixture()`, `sampleClone()`)
  - Fake implementations for DI (`FakeWrapperManager`, `installFakeCodex`)
  - Concurrent write tests (40 parallel upserts in registry.test.ts)
- **CLI smoke test** (`cli-smoke.test.ts`): Full create/list/login/doctor/remove workflow, 20s timeout

When adding features, always add or update corresponding tests. Tests should verify both happy path and error/rollback scenarios.

## Core Types

```typescript
CloneRecord    // Persistent registry entry (id, name, rootPath, runtimeKind, wrapperPath, codexVersionPinned, timestamps)
Registry       // { version: 1, clones: CloneRecord[] }
RuntimeInfo    // Detected Codex info (kind: "npm-package" | "binary", entryPath, version)
ClonePaths     // Derived directory structure for a clone
DoctorResult   // Health check result (ok, authStatus, writable, errors[])
MirrorContext  // Global config (globalRoot, registryPath, defaultBinDir)
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `create --name <n>` | Create new isolated clone |
| `list [--json] [--full]` | List all clones |
| `run <name> [-- args]` | Launch Codex in clone context |
| `login <name>` | Authenticate clone |
| `logout <name>` | Deauthenticate clone |
| `update <name> / --all` | Update clone runtime to latest |
| `remove <name>` | Delete clone (with rollback safety) |
| `doctor [name] [--json]` | Health check |
| `wrapper install` | Install wrapper scripts |
| `path status / setup` | Manage shell PATH |

No command + no flags → launches interactive TUI.

## TUI Structure

The TUI uses a custom raw-mode renderer (not blessed/ink). Main menu actions:
Quick Clone → Manage Clones → Update All → Diagnostics → PATH Setup → Star on GitHub → About → Exit

TUI health results are cached in a `Map<string, DoctorResult>` within the session.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CODEX_MIRROR_HOME` | `~/.codex-mirror` | Global state root |
| `CODEX_MIRROR_BIN_DIR` | `~/.local/bin` | Wrapper script directory |
| `CODEX_MIRROR_CLI` | — | Override CLI path in wrapper scripts |

## CI/CD

- **CI**: GitHub Actions on push to main + PRs. Matrix: ubuntu + macos, Node 20 + 22. Runs `npm run check`.
- **Release**: Tag push (`v*`) → validates tag matches package.json → `npm publish --provenance` → GitHub Release.
- **Dependabot**: Weekly updates for npm deps and GitHub Actions.

## Important Guidelines

- Always run `npm run check` before pushing.
- Never break transactional safety — all create/update/remove must roll back on failure.
- Keep wrapper path confinement and clone name validation intact. These are security controls.
- Registry file mode is `0o600`. Atomic writes via temp+rename are required.
- The TUI files (`tui/index.ts` at 684 lines, `tui/menu.ts` at 614 lines) are the largest — consider splitting when adding features.
- `src/utils/logger.ts` exists but is unused. Wire it up if adding debug logging.
- Production deps must stay minimal. Avoid adding deps unless absolutely necessary.

## Documentation

- `docs/ARCHITECTURE.md` — Component design, lifecycle transactions, concurrency
- `docs/SECURITY.md` — Threat model, 5 security controls with source references
- `docs/OPERATIONS.md` — CLI reference, backup/restore, env vars
- `docs/TROUBLESHOOTING.md` — Common issues and remedies
- `docs/ROADMAP.md` — Phase 1 (current) and Phase 2 (multi-provider) plans
- `docs/RELEASE.md` — Semver policy, tag-driven publish workflow
