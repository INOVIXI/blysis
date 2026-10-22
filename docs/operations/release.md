# Releasing a version

A release is a version in `package.json`, a tag, a GitHub release and an image. Installations learn about it from `releases.json` on `main`.

## Steps

1. On `main`, with CI green, bump `version` in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`).
2. Add the release to `releases.json`: `version` and `tag` as `X.Y.Z`, `publishedAt`, a one-sentence `notes` saying what changed for an operator, `security: true` when it fixes a vulnerability, and `minVersion` when an installation older than that cannot move straight to this one. Set the file's `updated` to the same day.
3. Commit both as `chore: X.Y.Z`, and nothing else in that commit.
4. Tag it `vX.Y.Z` and push the commit and the tag.
5. Publish a GitHub release on the tag, titled `vX.Y.Z - <the same sentence>`.

Publishing the release runs `.github/workflows/release-pipeline.yml`. It first checks that the tag, the release's pre-release flag and `package.json` agree, then runs the whole of `build-and-test.yml`, then builds the image and pushes it to `ghcr.io/inovixi/blysis` as `X.Y.Z`, `X.Y`, `X`, `vX.Y.Z` and `latest`.

## A pre-release

A beta or a release candidate is the same steps with a suffix on the number: `X.Y.Z-beta.N` or `X.Y.Z-rc.N`, in `package.json`, in `releases.json`, in the tag and in the commit (`chore: X.Y.Z-beta.N`). Tick **Set as a pre-release** on the GitHub release; the pipeline stops when the box and the suffix disagree.

The suffix is the whole of what makes it a pre-release. `src/core/lib/core-releases.ts` reads the channel from the number, so there is no field to set, and orders the versions as semver does: `0.13.0-beta.1`, `0.13.0-beta.2`, `0.13.0-rc.1`, `0.13.0`. Only `beta` and `rc` are accepted; any other suffix is dropped from the feed, as is a pre-release whose number is not three parts. A pre-release image is pushed as `X.Y.Z-beta.N` and `vX.Y.Z-beta.N` only; the pipeline turns `latest`, `X.Y` and `X` off for it, so neither a fresh install nor `blysis update` lands on one.

Sites on the beta channel are offered betas, candidates and releases; sites on the stable channel only releases. An installation older than the release that taught the parser about suffixes drops these entries, so it is never offered one. There is no way back down from a pre-release, because updates only add to the database: a site that leaves the beta channel stays where it is until `X.Y.Z` itself ships.

## Why `releases.json` is part of the release commit

Every installation's **Admin > Updates** screen reads `releases.json` from `main`, through the parser in `src/core/lib/core-releases.ts`. Nothing else tells an installation that a version exists: the file once stopped at 0.2.1 while nine releases shipped after it, three of them security releases, and every installation was told it was up to date. `tests/unit/the-release-feed-offers-the-release-that-shipped.test.ts` now fails when the feed does not offer the version `package.json` says this tree is.

A `tag` names the image an installation pulls, so it is checked against the characters a Docker tag may contain, both when the feed is read and again by the updater.

## Versions

Blysis is before 1.0. A minor release changes behaviour an operator will notice; a patch fixes something. The product version is not `CORE_API_VERSION` in `src/core/lib/core-version.ts`, which versions the SDK modules build against and moves on its own rules.
