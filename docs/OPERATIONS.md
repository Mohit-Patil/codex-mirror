# Operations

## Common operator tasks

Examples below use the installed command.
For local development from source, replace `codex-mirror` with `node dist/cli.js`.

## Health checks

```bash
codex-mirror doctor
codex-mirror doctor <clone>
codex-mirror doctor --json
```

## Upgrade all clones to current installed Codex

```bash
codex-mirror update --all
```

## Upgrade one clone

```bash
codex-mirror update <clone>
```

## Reinstall wrappers

```bash
codex-mirror wrapper install
```

## Check/setup PATH for wrappers

```bash
codex-mirror path status
codex-mirror path setup
```

## Backup / restore

Backup:

```bash
cp -R ~/.codex-mirror ~/.codex-mirror.backup.$(date +%Y%m%d-%H%M%S)
```

Restore:

```bash
rm -rf ~/.codex-mirror
cp -R ~/.codex-mirror.backup.<timestamp> ~/.codex-mirror
```

Then reinstall wrappers:

```bash
codex-mirror wrapper install
```

## Cleanup removed/unused clones

List:

```bash
codex-mirror list --full
```

Remove one:

```bash
codex-mirror remove <clone>
```

## Environment controls

- `CODEX_MIRROR_HOME`
  - Global state root (registry + clone roots default base).
- `CODEX_MIRROR_BIN_DIR`
  - Where clone wrapper commands are installed.
