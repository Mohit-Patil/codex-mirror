# Troubleshooting

Examples below use the installed command.
For local development from source, replace `codex-mirror` with `node dist/cli.js`.

## TUI key issues in Warp

Symptoms:

- Arrow keys seem inconsistent.
- Enter appears to skip screens.

Checks:

1. Run latest build (local source checkout):
   ```bash
   npm run build
   node dist/cli.js
   ```
2. Or run latest published package:
   ```bash
   npx codex-mirror@latest
   ```
3. Use a clean shell session (no background raw-mode process).
4. If needed, fall back to CLI commands (`create`, `list`, `run`, `doctor`) while debugging terminal behavior.

## "No clones found"

- Create one with `Quick Clone` or:
  ```bash
  codex-mirror create --name <clone>
  ```
- Verify registry:
  ```bash
  codex-mirror list --full
  ```

## Login starts unexpectedly

- Clone creation no longer forces login.
- Login is optional and prompted after clone creation.
- Manual login:
  ```bash
  codex-mirror login <clone>
  ```

## Wrapper points to wrong place

- Reinstall wrappers:
  ```bash
  codex-mirror wrapper install
  ```
- Verify configured wrapper dir:
  - `CODEX_MIRROR_BIN_DIR` env var
  - default `~/.local/bin`

## Clone command not found on Ubuntu

- Check whether wrapper bin dir is on PATH:
  ```bash
  codex-mirror path status
  ```
- Auto-configure your shell startup file:
  ```bash
  codex-mirror path setup
  ```
- Reload shell:
  ```bash
  . ~/.bashrc
  ```

## Diagnostics says auth unknown

- Run direct login status:
  ```bash
  codex-mirror run <clone> -- login status
  ```
- Then rerun:
  ```bash
  codex-mirror doctor <clone>
  ```

## Registry lock timeout

- Usually caused by another active mirror command.
- Wait for active command to finish and retry.
- If process crashed, stale lock auto-cleanup should clear it after timeout window.
