# Security

## Threat model

Primary threat class for this tool:

- Local misuse or malformed input causing destructive filesystem operations.
- Concurrent mirror processes corrupting shared registry state.

Not in scope:

- Host compromise by privileged attackers.
- Hard multi-tenant isolation across OS users.

## Controls implemented

## 1) Clone name validation

- Clone names are centrally validated in `src/core/clone-name.ts`.
- Rejected:
  - Empty names
  - Path separators (`/`, `\`)
  - `..` traversal patterns
  - Non-safe characters outside `[a-zA-Z0-9._-]`
  - Reserved Windows device names

## 2) Wrapper path confinement

- Wrapper path is resolved and checked against configured `binDir`.
- Computed wrapper path must stay inside `binDir`.
- Prevents write/delete outside wrapper directory.

## 3) Registry write safety

- Registry mutations acquire an exclusive lock file.
- Writes use temp-file + atomic rename.
- Prevents torn writes and most lost updates from concurrent CLI/TUI sessions.

## 4) Transactional lifecycle

- Create/update/remove include rollback logic.
- Best effort rollback restores registry and metadata consistency on failures.

## 5) Health-check timeouts

- Auth checks have bounded timeout.
- Prevents unbounded TUI stalls caused by hung subprocesses.

## Operational recommendations

- Keep `CODEX_MIRROR_BIN_DIR` private to your user account.
- Do not share clone roots across different OS users.
- Back up `~/.codex-mirror` before major upgrades.
