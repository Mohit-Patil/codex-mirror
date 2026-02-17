# codex-mirror

`codex-mirror` is a local multi-account manager for Codex.  
It creates centrally stored clones, each with isolated runtime and isolated auth/session/config state.

This project supports official Codex clones plus template-based clones (including MiniMax preset).
Broader multi-provider extensibility is planned for Phase 2.

> Unofficial community tool. Not affiliated with OpenAI.

## What you get

- Screen-based TUI (`codex-mirror`) with clone lifecycle management
- Centralized clone storage under one global home
- Per-clone runtime pinning (copied from currently installed Codex)
- Per-clone isolated `HOME` and XDG directories
- Wrapper command per clone name
- Template presets:
  - `official` (default)
  - `minimax` (preconfigured provider profile + default `--profile m21` + pinned runtime)
- Built-in diagnostics (`doctor`) for runtime/wrapper/writable/auth checks
- Safety protections:
  - Strict clone-name validation
  - Wrapper path confinement (no path traversal)
  - Registry lock + atomic writes
  - Transactional clone create/update/remove with rollback

## Requirements

- macOS/Linux (Node.js 20+)
- `codex` available on `PATH`

## Quick start

```bash
npm install
npm run build
node dist/cli.js
```

Global install (after publish):

```bash
npm install -g codex-mirror
codex-mirror
```

From the TUI:
1. Choose `Quick Clone` or `New Clone Wizard`.
2. For `MiniMax` template, paste `MINIMAX_API_KEY` in the same setup flow (optional but recommended).
3. Optionally run login for official Codex clones.
4. Use `Manage Clones` to run, update, remove.
5. Use `Diagnostics` for health checks.

## CLI usage

```bash
# Create clone (default root: ~/.codex-mirror/clones/<name>)
node dist/cli.js create --name work

# Create MiniMax template clone (auto-runs with --profile m21)
node dist/cli.js create --name mini --provider minimax

# Create MiniMax template clone and save API key clone-locally
node dist/cli.js create --name mini --provider minimax --minimax-api-key "<key>"

# List clones
node dist/cli.js list
node dist/cli.js list --full
node dist/cli.js list --json

# Run clone
node dist/cli.js run work
node dist/cli.js run work -- --model o3

# Login/logout
node dist/cli.js login work
node dist/cli.js logout work

# Health checks
node dist/cli.js doctor
node dist/cli.js doctor work --json

# Updates
node dist/cli.js update work
node dist/cli.js update --all

# Remove clone
node dist/cli.js remove work

# Reinstall wrappers
node dist/cli.js wrapper install

# Check/setup PATH for wrapper commands
node dist/cli.js path status
node dist/cli.js path setup
```

MiniMax template note:

```bash
export MINIMAX_API_KEY="..."
mini
```

By default, MiniMax templates pin Codex runtime to `0.57.0` for compatibility.
The default MiniMax profile model is `MiniMax-M2.5`.

## Data layout

Default locations:

- Mirror home: `~/.codex-mirror`
- Registry: `~/.codex-mirror/registry.json`
- Clone root: `~/.codex-mirror/clones/<clone-name>`
- Wrapper binaries: `~/.local/bin/<clone-name>`

Per clone:

```text
<clone-root>/
  .codex-mirror/
    clone.json
    secrets.json
    runtime/
    home/
      .codex/
      .config/
      .local/share/
      .cache/
    logs/
```

Path overrides:

- `CODEX_MIRROR_HOME` (changes global root)
- `CODEX_MIRROR_BIN_DIR` (changes wrapper output dir)
- `CODEX_MIRROR_MINIMAX_CODEX_VERSION` (override pinned Codex version for MiniMax templates)
- `CODEX_MIRROR_DISABLE_MINIMAX_RUNTIME_PIN=1` (disable MiniMax runtime pinning)

After adding clones, if wrappers are not found by name:

```bash
codex-mirror path setup
```

Then reload shell (example for bash):

```bash
. ~/.bashrc
```

## Safety model

- Clone names are validated and must be filesystem-safe.
- Wrapper paths are forced to remain inside configured wrapper directory.
- Provider secrets are stored per clone in `.codex-mirror/secrets.json` (mode `0600`).
- Registry updates are lock-protected and written atomically.
- Create/update/remove operations include rollback to avoid partial state.
- Health checks use bounded concurrency and auth timeouts.

Detailed docs:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/OPERATIONS.md`
- `docs/TROUBLESHOOTING.md`
- `docs/ROADMAP.md`
- `docs/RELEASE.md`

## Development

```bash
npm run check
```

## Community

- Contributing guide: `CONTRIBUTING.md`
- Code of Conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- Support info: `SUPPORT.md`

## Maintainer release flow

1. Ensure `main` is green in CI.
2. Update version:
   ```bash
   npm version patch
   ```
3. Push commit + tag:
   ```bash
   git push origin main --follow-tags
   ```
4. Tag trigger `v*` will run `.github/workflows/release.yml` and publish to npm.
