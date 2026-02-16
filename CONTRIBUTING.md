# Contributing to codex-mirror

Thanks for contributing.

## Ground rules

- Keep changes focused and small.
- Add/update tests for behavioral changes.
- Keep all checks passing before opening a PR.
- Follow existing code style and naming conventions.

## Local development

```bash
npm install
npm run check
```

For interactive work:

```bash
npm run dev
```

## Pull request checklist

1. Include a clear problem statement and solution summary.
2. Add tests (or explain why tests are not applicable).
3. Update docs when behavior/CLI/TUI output changes.
4. Ensure `npm run check` passes.

## Commit style

Conventional Commits are recommended but not required.

Examples:

- `feat: improve diagnostics timeout handling`
- `fix: prevent wrapper path traversal`
- `docs: add operations guide`

## Security issues

Do not open public issues for sensitive vulnerabilities.  
Use the reporting guidance in `SECURITY.md`.
