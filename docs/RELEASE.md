# Release Guide

## Preconditions

- CI is passing on `main`.
- `npm run check` passes locally.
- `NPM_TOKEN` secret is configured in GitHub repo settings.

## Versioning

Use semver:

- patch: bug fixes
- minor: backward-compatible features
- major: breaking changes

Bump version:

```bash
npm version patch
```

## Publish flow

1. Push commit and tag:
   ```bash
   git push origin main --follow-tags
   ```
2. `Release` workflow runs on `v*` tags.
3. Workflow verifies package and publishes to npm.

## Dry run

Before tagging:

```bash
npm pack --dry-run
```

Inspect package contents and ensure `dist/`, `README.md`, and `LICENSE` are included.
