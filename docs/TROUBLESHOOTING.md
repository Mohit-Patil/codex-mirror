# Troubleshooting

## TUI key issues in Warp

Symptoms:

- Arrow keys seem inconsistent.
- Enter appears to skip screens.

Checks:

1. Run latest build:
   ```bash
   npm run build
   node dist/cli.js
   ```
2. Use a clean shell session (no background raw-mode process).
3. If needed, fall back to CLI commands (`create`, `list`, `run`, `doctor`) while debugging terminal behavior.

## "No clones found"

- Create one with `Quick Clone` or:
  ```bash
  node dist/cli.js create --name <clone>
  ```
- Verify registry:
  ```bash
  node dist/cli.js list --full
  ```

## Login starts unexpectedly

- Clone creation no longer forces login.
- Login is optional and prompted after clone creation.
- Manual login:
  ```bash
  node dist/cli.js login <clone>
  ```

## Wrapper points to wrong place

- Reinstall wrappers:
  ```bash
  node dist/cli.js wrapper install
  ```
- Verify configured wrapper dir:
  - `CODEX_MIRROR_BIN_DIR` env var
  - default `~/.local/bin`

## Clone command not found on Ubuntu

- Check whether wrapper bin dir is on PATH:
  ```bash
  node dist/cli.js path status
  ```
- Auto-configure your shell startup file:
  ```bash
  node dist/cli.js path setup
  ```
- Reload shell:
  ```bash
  . ~/.bashrc
  ```

## Diagnostics says auth unknown

- Run direct login status:
  ```bash
  node dist/cli.js run <clone> -- login status
  ```
- Then rerun:
  ```bash
  node dist/cli.js doctor <clone>
  ```

## Registry lock timeout

- Usually caused by another active mirror command.
- Wait for active command to finish and retry.
- If process crashed, stale lock auto-cleanup should clear it after timeout window.
