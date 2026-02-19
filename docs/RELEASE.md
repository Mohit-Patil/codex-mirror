# Release Guide

## Preconditions

- CI is passing on `main`.
- `npm run check` passes locally.
- `NPM_TOKEN` secret is configured in GitHub repo settings.
- Working tree is clean for release files.
- `main` branch protections are enabled (required reviews and required status checks).
- Release tag policy is in place:
  - Tags are created only from `main`.
  - Only trusted maintainers can push release tags.
  - Signed tags are required by your repository/ruleset policy.

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
4. Workflow validates tag provenance (annotated tag, commit reachable from `origin/main`, and optional trusted actor allowlist).
5. Workflow verifies package, verifies tag/version match, and publishes to npm.
6. Workflow creates or updates a GitHub Release entry for the same tag with generated notes.

## Tag provenance policy

Release tags are treated as deployment authority. Keep this policy enforced:

- Protect `main` with required status checks and restricted push access.
- Use annotated tags for releases (`git tag -a` or `git tag -s`).
- Prefer signed annotated tags (`git tag -s`) and enforce signed-tag policy through GitHub rulesets/organization policy.
- Restrict release tag pushes to trusted maintainers.
- Optionally enforce actor allowlist in workflow by setting repository variable `RELEASE_TRUSTED_ACTORS` (comma-separated GitHub usernames).

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
git tag -s "v${PKG_VERSION}" -m "${PKG_VERSION}"
git push origin "v${PKG_VERSION}"
```

## Dry run

Before tagging:

```bash
npm pack --dry-run
```

Inspect package contents and ensure `dist/`, `README.md`, and `LICENSE` are included.
