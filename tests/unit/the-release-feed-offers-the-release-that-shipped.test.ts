// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isNewerVersion, latestRelease, parseReleases, stageOf } from "@/core/lib/core-releases";

/**
 * The release feed offers the release this tree is.
 *
 * Every installation's update screen reads `releases.json` from this
 * repository's main branch, and nothing in the release process wrote to it:
 * it stopped at 0.2.1 while nine releases shipped after it, three of them
 * security releases. An installation on 0.2.1 was told it was up to date.
 *
 * A release commit bumps `package.json`, so the feed is held to that, read
 * through the same parser the update screen uses: no entry is one the parser
 * would quietly drop, and an installation on the oldest listed release is
 * offered exactly the version the tree says it is, on the channel that
 * version belongs to: a beta tree is offered to the sites that follow betas.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "releases.json"), "utf8")) as { releases: unknown[] };
const releases = parseReleases(raw);

describe("the release feed", () => {
    it("has no entry the update screen would drop as unreadable", () => {
        expect(releases).toHaveLength(raw.releases.length);
    });

    it("offers the oldest listed installation the version package.json says this tree is", () => {
        const oldest = releases.map((r) => r.version).reduce((a, b) => (isNewerVersion(b, a) ? b : a));
        const channel = stageOf(pkg.version) === "stable" ? "stable" : "beta";
        expect(latestRelease(releases, oldest, channel)?.version).toBe(pkg.version);
    });
});
