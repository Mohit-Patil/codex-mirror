# Operations

## Common operator tasks

## Health checks

```bash
node dist/cli.js doctor
node dist/cli.js doctor <clone>
node dist/cli.js doctor --json
```

## Upgrade all clones to current installed Codex

```bash
node dist/cli.js update --all
```

## Upgrade one clone

```bash
node dist/cli.js update <clone>
```

## Reinstall wrappers

```bash
node dist/cli.js wrapper install
```

## Check/setup PATH for wrappers

```bash
node dist/cli.js path status
node dist/cli.js path setup
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
node dist/cli.js wrapper install
```

## Cleanup removed/unused clones

List:

```bash
node dist/cli.js list --full
```

Remove one:

```bash
node dist/cli.js remove <clone>
```

## Environment controls

- `CODEX_MIRROR_HOME`
  - Global state root (registry + clone roots default base).
- `CODEX_MIRROR_BIN_DIR`
  - Where clone wrapper commands are installed.
