# Architecture

## Goals

- Run multiple Codex clones on one machine with isolated state.
- Keep clone management safe under concurrent usage.
- Keep TUI fast and deterministic.

## Core components

- `src/cli.ts`
  - Entry point for both command mode and TUI mode.
- `src/core/clone-manager.ts`
  - Lifecycle orchestration: create, update, remove, list.
  - Transaction and rollback boundaries.
- `src/core/runtime-cloner.ts`
  - Detects installed Codex and copies runtime into clone-local runtime dir.
- `src/core/wrapper-manager.ts`
  - Creates/removes wrapper scripts in configured bin dir.
  - Enforces path confinement for wrapper outputs.
- `src/core/registry.ts`
  - Global clone registry (`registry.json`).
  - Locking and atomic write strategy for concurrency safety.
- `src/core/launcher.ts`
  - Launches clone runtime with clone-isolated environment (`HOME`, `XDG_*`).
- `src/core/doctor.ts`
  - Health checks for runtime, wrapper, writable dirs, and auth state.
- `src/tui/*`
  - Screen-based interactive manager.

## Clone lifecycle

Create:
1. Validate clone name.
2. Prepare clone directories.
3. Install runtime copy.
4. Install wrapper.
5. Write clone metadata.
6. Upsert registry entry.
7. On failure, rollback wrapper/metadata/registry/clone dir.

Update:
1. Snapshot existing runtime.
2. Reinstall runtime copy.
3. Refresh wrapper and metadata.
4. Upsert registry.
5. On failure, restore runtime snapshot + previous metadata/registry.

Remove:
1. Remove clone from registry.
2. Delete clone data + wrapper.
3. On failure, reinsert clone in registry.

## Registry consistency

- Lock file: `<registry>.lock` (exclusive create).
- All mutating operations are inside lock scope.
- Writes are atomic via temporary file + rename.
- Stale lock cleanup is time-based.

## TUI model

- TUI is state/screen based; each action has its own screen.
- Keyboard input is raw-mode parsed, with explicit handling for arrows/enter/escape.
- Diagnostics are explicit (not forced on each screen render), reducing UI stalls.
