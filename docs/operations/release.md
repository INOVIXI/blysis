# Releasing a version

A release is a version in `package.json`, a tag, a GitHub release and an image. Installations learn about it from `releases.json` on `main`.

## Steps

1. On `main`, with CI green, bump `version` in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`).
2. Add the release to `releases.json`: `version` and `tag` as `X.Y.Z`, `publishedAt`, a one-sentence `notes` saying what changed for an operator, `security: true` when it fixes a vulnerability, `channel: "stable"`, and `minVersion` when an installation older than that cannot move straight to this one. Set the file's `updated` to the same day.
3. Commit both as `chore: X.Y.Z`, and nothing else in that commit.
4. Tag it `vX.Y.Z` and push the commit and the tag.
5. Publish a GitHub release on the tag, titled `vX.Y.Z - <the same sentence>`.

Publishing the release runs `.github/workflows/release-pipeline.yml`: the whole of `build-and-test.yml` first, then the image is built and pushed to `ghcr.io/inovixi/blysis` as `X.Y.Z`, `X.Y`, `X`, `vX.Y.Z` and, for a release that is not a prerelease, `latest`.

## Why `releases.json` is part of the release commit

Every installation's **Admin > Updates** screen reads `releases.json` from `main`, through the parser in `src/core/lib/core-releases.ts`. Nothing else tells an installation that a version exists: the file once stopped at 0.2.1 while nine releases shipped after it, three of them security releases, and every installation was told it was up to date. `tests/unit/the-release-feed-offers-the-release-that-shipped.test.ts` now fails when the feed does not offer the version `package.json` says this tree is.

A `tag` names the image an installation pulls, so it is checked against the characters a Docker tag may contain, both when the feed is read and again by the updater.

## Versions

Blysis is before 1.0. A minor release changes behaviour an operator will notice; a patch fixes something. The product version is not `CORE_API_VERSION` in `src/core/lib/core-version.ts`, which versions the SDK modules build against and moves on its own rules.
