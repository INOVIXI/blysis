/**
 * Which versions of Blysis exist, and which one an install may move to.
 *
 * The feed is a static `releases.json` published beside the module catalogue,
 * on the base `BLYSIS_MARKETPLACE_BASE` already points at, so a fork or an
 * air-gapped mirror serves its own releases with no extra configuration. It is
 * a file rather than the GitHub releases API for three reasons: no rate limit
 * on an unauthenticated read, fields this product decides (a security flag, a
 * minimum version, the image tag), and one channel to point somewhere else
 * instead of two.
 *
 * Everything here treats the feed as what it is: text fetched over a network
 * from a place the operator can repoint. The tag in particular ends up naming
 * an image to pull, so it is checked against the alphabet a tag may use at the
 * boundary, once, rather than escaped by each reader in turn.
 */
import { z } from "zod";
import { marketplaceBase } from "./marketplace-source";

/** Where the catalogue of core versions lives. */
export function coreReleasesUrl(): string {
    return `${marketplaceBase()}/releases.json`;
}

/**
 * A tag is what Docker accepts and nothing else: letters, digits, and the
 * three separators, up to 128 characters. `latest` is deliberately allowed -
 * an operator may run a rolling tag - but a path, a space or a shell
 * metacharacter is not a tag and never reaches the updater.
 */
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * A version is dotted numbers, optionally written with the tag's leading v,
 * and a pre-release says so in a full three-part number: `0.13.0-beta.1`,
 * `0.13.0-rc.2`. Only those two words, each numbered, because the word is what puts a
 * release on the beta channel and anything else would reach an operator
 * under a name nobody decided to give it.
 */
const VERSION = /^v?(\d+(\.\d+)*|\d+\.\d+\.\d+-(beta|rc)\.\d+)$/;

/** Where a release stands. Only `stable` is offered to a site on the stable channel. */
export type ReleaseStage = "stable" | "beta" | "rc";

export type UpdateChannel = "stable" | "beta";

const releaseSchema = z.object({
    version: z.string().regex(VERSION),
    tag: z.string().regex(TAG),
    publishedAt: z.string().min(1),
    notes: z.string().default(""),
    security: z.boolean().default(false),
    /** The oldest version that may move straight to this one. */
    minVersion: z.string().regex(VERSION).nullable().default(null),
});

export type CoreRelease = z.infer<typeof releaseSchema>;

const feedSchema = z.object({ releases: z.array(z.unknown()) });

/**
 * The releases in a feed, with anything unreadable dropped.
 *
 * One bad entry does not lose the rest: a feed is written by a release
 * pipeline, and a half-published entry must not hide a security release
 * further down the list.
 */
export function parseReleases(raw: unknown): CoreRelease[] {
    const feed = feedSchema.safeParse(raw);
    if (!feed.success) return [];
    const out: CoreRelease[] = [];
    for (const entry of feed.data.releases) {
        const parsed = releaseSchema.safeParse(entry);
        if (parsed.success) out.push(parsed.data);
    }
    return out;
}

interface VersionParts {
    numbers: number[];
    /** Null for a release; for a pre-release, its stage and its number within it. */
    pre: { stage: "beta" | "rc"; n: number } | null;
}

function parts(version: string): VersionParts | null {
    if (!VERSION.test(version)) return null;
    const [release, suffix] = version.replace(/^v/, "").split("-");
    if (!suffix) return { numbers: release.split(".").map(Number), pre: null };
    const [stage, n] = suffix.split(".");
    return { numbers: release.split(".").map(Number), pre: { stage: stage as "beta" | "rc", n: Number(n) } };
}

/** Is this version a release, or which kind of preview of one? */
export function stageOf(version: string): ReleaseStage {
    return parts(version)?.pre?.stage ?? "stable";
}

const PRE_RANK = { beta: 0, rc: 1 } as const;

/**
 * Is `latest` a version this install has not got yet?
 *
 * Ordered the way semver orders them: the numbers first, then a pre-release
 * before the release it previews, a beta before a candidate, and within a
 * stage by its number, so `beta.10` follows `beta.9`.
 */
export function isNewerVersion(current: string, latest: string): boolean {
    const c = parts(current);
    const l = parts(latest);
    if (!c || !l) return false;
    for (let i = 0; i < Math.max(c.numbers.length, l.numbers.length); i++) {
        const cv = c.numbers[i] ?? 0;
        const lv = l.numbers[i] ?? 0;
        if (lv > cv) return true;
        if (lv < cv) return false;
    }
    if (!c.pre || !l.pre) return c.pre !== null && l.pre === null;
    if (c.pre.stage !== l.pre.stage) return PRE_RANK[l.pre.stage] > PRE_RANK[c.pre.stage];
    return l.pre.n > c.pre.n;
}

/** Whether a site following this channel may be offered this version. */
export function onChannel(version: string, channel: UpdateChannel): boolean {
    return channel === "beta" || stageOf(version) === "stable";
}

/**
 * The newest release worth offering, or null when there is nothing to do.
 *
 * A beta channel sees betas and candidates as well as stable releases,
 * because a beta line that hid the stable fix released after it would be
 * worse than useless.
 */
export function latestRelease(
    releases: CoreRelease[],
    current: string,
    channel: UpdateChannel,
): CoreRelease | null {
    const eligible = releases.filter(
        (r) => onChannel(r.version, channel) && isNewerVersion(current, r.version),
    );
    if (eligible.length === 0) return null;
    return eligible.reduce((best, r) => (isNewerVersion(best.version, r.version) ? r : best));
}

/**
 * The release that has to be installed first, if this one cannot be reached
 * directly. Null when the jump is allowed.
 *
 * `minVersion` is how a release says "I assume the migrations that shipped in
 * X have run". Skipping it would apply this version's migrations to a schema
 * they were never written against.
 */
export function blockedBy(target: CoreRelease, current: string): { version: string } | null {
    if (!target.minVersion) return null;
    if (!isNewerVersion(current, target.minVersion)) return null;
    return { version: target.minVersion.replace(/^v/, "") };
}

export interface NextStep {
    /** The version this install may move to now, or null when there is none. */
    target: CoreRelease | null;
    /** The newest release on the channel, which may be further than `target`. */
    newest: CoreRelease | null;
}

/**
 * What to offer: the newest version, or the step that has to come first.
 *
 * A release that declares a `minVersion` cannot be reached from further back,
 * because its migrations were written against a schema that release left
 * behind. Offering it anyway would put the refusal at the end of the button
 * rather than on the screen, so the panel offers the step and says what is
 * waiting after it.
 */
export function nextInstallable(
    releases: CoreRelease[],
    current: string,
    channel: UpdateChannel,
): NextStep {
    const newest = latestRelease(releases, current, channel);
    if (!newest) return { target: null, newest: null };

    const step = blockedBy(newest, current);
    if (!step) return { target: newest, newest };

    const stepRelease = releases.find((r) => r.version.replace(/^v/, "") === step.version) ?? null;
    // A feed that names a step it does not carry is a broken feed: offer
    // nothing rather than a version nobody can fetch.
    return { target: stepRelease, newest };
}
