# codex-mirror

`codex-mirror` is a local multi-account manager for Codex.  
It creates centrally stored clones, each with isolated runtime and isolated auth/session/config state.

This project currently targets **official Codex only** (Phase 1). Multi-provider support is planned for Phase 2.

> Unofficial community tool. Not affiliated with OpenAI.

## What you get

- Screen-based TUI (`codex-mirror`) with clone lifecycle management
- Centralized clone storage under one global home
- Per-clone runtime pinning (copied from currently installed Codex)
- Per-clone isolated `HOME` and XDG directories
- Wrapper command per clone name
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

Direct run (no install):

```bash
npx codex-mirror@latest
```

Global install:

```bash
npm install -g codex-mirror
codex-mirror
```

Local development:

```bash
npm install
npm run build
node dist/cli.js
```

## Demo

![codex-mirror demo](docs/assets/demo.gif)

```bash
npx codex-mirror@latest
```

`GIF source path:` `docs/assets/demo.gif`
`Direct link (for npm):` `https://raw.githubusercontent.com/Mohit-Patil/codex-mirror/main/docs/assets/demo.gif`

From the TUI main menu:
1. Choose `Quick Clone`.
2. Optionally run login for that clone.
3. Use `Manage Clones` to run, update, remove.
4. Use `Diagnostics` for health checks.
5. Use `Shell PATH Setup` to auto-configure wrapper discovery.
6. Use `Star on GitHub` to open the repository page.
7. Choose `Exit` for a final `Star and Exit` / `Skip and Exit` prompt.

## CLI usage

Examples below use the installed command.
For local development from source, replace `codex-mirror` with `node dist/cli.js`.

```bash
# Create clone (default root: ~/.codex-mirror/clones/<name>)
codex-mirror create --name work

# List clones
codex-mirror list
codex-mirror list --full
codex-mirror list --json

# Run clone
codex-mirror run work
codex-mirror run work -- --model o3

# Login/logout
codex-mirror login work
codex-mirror logout work

# Health checks
codex-mirror doctor
codex-mirror doctor work --json

# Updates
codex-mirror update work
codex-mirror update --all

# Remove clone
codex-mirror remove work

# Reinstall wrappers
codex-mirror wrapper install

# Check/setup PATH for wrapper commands
codex-mirror path status
codex-mirror path setup
```

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
4. Tag trigger `v*` runs `.github/workflows/release.yml` and publishes to npm.
5. Release workflow enforces `tag version == package.json version` (for example: `v0.1.5` requires `"version": "0.1.5"`).
