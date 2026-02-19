# Release Guide

## Preconditions

- CI is passing on `main`.
- `npm run check` passes locally.
- `NPM_TOKEN` secret is configured in GitHub repo settings.
- Working tree is clean for release files.

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

1. Bump version (creates commit + tag):
   ```bash
   npm version patch
   ```
2. Push commit and tag:
   ```bash
   git push origin main --follow-tags
   ```
3. `Release` workflow runs on `v*` tags.
4. Workflow verifies package, verifies tag/version match, and publishes to npm.
5. Workflow creates or updates a GitHub Release entry for the same tag with generated notes.

## Tag/version guard

Release workflow validates:

```bash
TAG_VERSION="${GITHUB_REF_NAME#v}"
PKG_VERSION="$(node -p "require('./package.json').version")"
```

If they do not match, release fails.

Manual tag creation must use the package version exactly:

```bash
PKG_VERSION="$(node -p "require('./package.json').version")"
git tag -a "v${PKG_VERSION}" -m "${PKG_VERSION}"
git push origin "v${PKG_VERSION}"
```

## Dry run

Before tagging:

```bash
npm pack --dry-run
```

Inspect package contents and ensure `dist/`, `README.md`, and `LICENSE` are included.
