/**
 * Core's review round: what waits in a kind set to "review" goes to the
 * reviewing module, and core applies the answer.
 *
 * The reviewer only judges. Reading the queue, telling an edited post from the
 * one already judged, and changing an item's state stay here, so a reviewer
 * cannot touch a kind the admin did not hand it, and every decision is made
 * through `decide`, the same path a moderator's button takes.
 *
 * ## Towards a person
 *
 * Every way this can go wrong ends with the item still waiting:
 *
 * - An answer core cannot apply (a reason the site does not offer, a
 *   rejection with none, an item it did not ask about) is "leave".
 * - A reviewer that throws, or skips an item, costs that item an attempt. An
 *   item out of attempts is not handed over again; it waits for a person.
 * - An item its author asked a person to look at (`humanOnly`) is never
 *   handed over again, and neither is one a moderator decided while the
 *   reviewer was thinking: state is read again before anything is applied.
 * - No reviewer, two of them, or module states that cannot be read: nothing
 *   is handed over. Two would mean picking one for the admin.
 *
 * A round that outlasts the scheduler's minute must not overlap the next one,
 * which would hand the same item over twice; one process runs the site (see
 * `install-lock.ts`), so a flag here is enough.
 *
 * `tests/unit/a-reviewer-decides-only-what-it-may.test.ts` holds each rule.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/core/lib/db";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { decide } from "@/core/lib/moderation-decisions";
import { moderationModes } from "@/core/lib/moderation-mode";
import { errorText, log } from "@/core/lib/logger";
import {
    ModuleModerationProviders,
    ModuleModerationReviewers,
    type ModeratedText,
    type ModerationProvider,
    type ModerationReviewer,
    type ReviewCapacity,
    type ReviewItem,
    type ReviewVerdict,
} from "@/core/generated/module-moderation";

/** How far down a long queue one round looks for items it has not judged. */
const SCAN_LIMIT = 1000;
const PAGE = 100;

const BOUNDS = {
    perRun: { min: 1, max: 500 },
    batchSize: { min: 1, max: 50 },
    maxAttempts: { min: 1, max: 20 },
} as const;

let running = false;

export interface ActiveReviewer {
    id: string;
    name: string;
    impl: ModerationReviewer;
}

/** The enabled reviewers, or none when the module states cannot be read. */
async function enabledReviewers(): Promise<typeof ModuleModerationReviewers> {
    if (ModuleModerationReviewers.length === 0) return [];
    try {
        const states = await getModuleStates();
        return ModuleModerationReviewers.filter((r) => isEnabledIn(states, r.module));
    } catch (err) {
        log.warn("[moderation] module states could not be read; no review this round", { error: errorText(err) });
        return [];
    }
}

/**
 * Who reviews, for the settings screen as well as the round: the one enabled
 * reviewer, or null with `conflict` when more than one is on.
 */
export async function reviewerStatus(): Promise<{ reviewer: { id: string; name: string } | null; conflict: boolean }> {
    const enabled = await enabledReviewers();
    if (enabled.length === 1) return { reviewer: { id: enabled[0].id, name: enabled[0].name }, conflict: false };
    return { reviewer: null, conflict: enabled.length > 1 };
}

async function activeReviewer(): Promise<ActiveReviewer | null> {
    const enabled = await enabledReviewers();
    if (enabled.length !== 1) return null;
    const [entry] = enabled;
    try {
        const impl = (await entry.loader()).default;
        return { id: entry.id, name: entry.name, impl };
    } catch (err) {
        log.error("[moderation] the reviewer could not be loaded", { reviewer: entry.id, error: errorText(err) });
        return null;
    }
}

function bounded(raw: unknown, { min, max }: { min: number; max: number }): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function capacityOf(raw: ReviewCapacity): ReviewCapacity {
    return {
        perRun: bounded(raw?.perRun, BOUNDS.perRun),
        batchSize: bounded(raw?.batchSize, BOUNDS.batchSize),
        maxAttempts: bounded(raw?.maxAttempts, BOUNDS.maxAttempts),
        kinds: Array.isArray(raw?.kinds) ? raw.kinds.filter((k): k is string => typeof k === "string") : [],
    };
}

/** What identifies the text judged: an edit makes another. */
export function versionOf(item: Pick<ModeratedText, "title" | "body">): string {
    return createHash("sha256").update(`${item.title ?? ""}\u0000${item.body}`, "utf8").digest("hex").slice(0, 32);
}

interface Kind {
    id: string;
    label: string;
    impl: ModerationProvider & { read: NonNullable<ModerationProvider["read"]> };
}

/** The kinds this round may read: set to "review", handed to this reviewer, and readable. */
async function reviewableKinds(capacity: ReviewCapacity): Promise<Kind[]> {
    const [modes, states] = await Promise.all([moderationModes(), getModuleStates()]);
    const out: Kind[] = [];
    for (const provider of ModuleModerationProviders) {
        if (!provider.settingKey || modes[provider.settingKey] !== "review") continue;
        if (capacity.kinds.length > 0 && !capacity.kinds.includes(provider.id)) continue;
        if (!isEnabledIn(states, provider.module)) continue;
        try {
            const impl = (await provider.loader()).default;
            if (typeof impl.read !== "function") continue;
            out.push({ id: provider.id, label: provider.label, impl: impl as Kind["impl"] });
        } catch (err) {
            log.error("[moderation] a provider could not be loaded for review", { provider: provider.id, error: errorText(err) });
        }
    }
    return out;
}

/** Items of one kind that are waiting, unjudged in this version, and still the reviewer's to judge. */
async function candidates(kind: Kind, wanted: number, maxAttempts: number): Promise<ReviewItem[]> {
    const found: ReviewItem[] = [];
    for (let skip = 0; skip < SCAN_LIMIT && found.length < wanted; skip += PAGE) {
        const { items } = await kind.impl.list(skip, PAGE);
        if (items.length === 0) break;
        const ids = items.map((i) => i.id);
        const [texts, asked, rows] = await Promise.all([
            kind.impl.read(ids),
            prisma.moderationDecision.findMany({
                where: { provider: kind.id, itemId: { in: ids }, humanOnly: true },
                select: { itemId: true },
            }),
            prisma.moderationReview.findMany({
                where: { provider: kind.id, itemId: { in: ids } },
                select: { itemId: true, version: true, attempts: true, settled: true },
            }),
        ]);
        const forPerson = new Set(asked.map((a) => a.itemId));
        const done = new Set(rows.filter((r) => r.settled || r.attempts >= maxAttempts).map((r) => `${r.itemId}\u0000${r.version}`));
        const byId = new Map(texts.map((t) => [t.id, t]));
        for (const id of ids) {
            const text = byId.get(id);
            if (!text || text.state !== "PENDING" || forPerson.has(id)) continue;
            const version = versionOf(text);
            if (done.has(`${id}\u0000${version}`)) continue;
            found.push({
                kind: kind.id,
                kindLabel: kind.label,
                itemId: id,
                version,
                authorId: text.authorId,
                ...(text.title ? { title: text.title } : {}),
                body: text.body,
            });
            if (found.length >= wanted) break;
        }
        if (items.length < PAGE) break;
    }
    return found;
}

async function record(item: ReviewItem, reviewer: string, outcome: "settled" | "failed"): Promise<void> {
    await prisma.moderationReview.upsert({
        where: { provider_itemId_version: { provider: item.kind, itemId: item.itemId, version: item.version } },
        create: {
            provider: item.kind,
            itemId: item.itemId,
            version: item.version,
            reviewer,
            attempts: outcome === "failed" ? 1 : 0,
            settled: outcome === "settled",
        },
        update: outcome === "failed" ? { attempts: { increment: 1 }, reviewer } : { settled: true, reviewer },
    });
}

/** Applies one batch's answers, after reading each item again. */
async function apply(kind: Kind, reviewer: ActiveReviewer, batch: ReviewItem[], verdicts: ReviewVerdict[], reasons: Set<string>): Promise<void> {
    const asked = new Set(batch.map((i) => i.itemId));
    const verdictOf = new Map<string, ReviewVerdict>();
    for (const v of Array.isArray(verdicts) ? verdicts : []) {
        if (v && typeof v.itemId === "string" && asked.has(v.itemId) && !verdictOf.has(v.itemId)) verdictOf.set(v.itemId, v);
    }

    const ids = batch.map((i) => i.itemId);
    const [now, askedNow] = await Promise.all([
        kind.impl.read(ids),
        prisma.moderationDecision.findMany({
            where: { provider: kind.id, itemId: { in: ids }, humanOnly: true },
            select: { itemId: true },
        }),
    ]);
    const current = new Map(now.map((t) => [t.id, t]));
    const forPerson = new Set(askedNow.map((a) => a.itemId));
    const provider = { id: kind.id, impl: kind.impl };

    for (const item of batch) {
        const verdict = verdictOf.get(item.itemId);
        if (!verdict) {
            await record(item, reviewer.id, "failed");
            continue;
        }
        await record(item, reviewer.id, "settled");

        const text = current.get(item.itemId);
        // Decided by a person, edited, or handed to a person meanwhile: the
        // answer was about something that is no longer there to judge.
        if (!text || text.state !== "PENDING" || versionOf(text) !== item.version || forPerson.has(item.itemId)) continue;

        if (verdict.decision === "approve") {
            await decide(provider, { ids: [item.itemId], state: "APPROVED", reasonId: null, reviewer: reviewer.id });
        } else if (verdict.decision === "reject" && typeof verdict.reasonId === "string" && reasons.has(verdict.reasonId)) {
            await decide(provider, { ids: [item.itemId], state: "REJECTED", reasonId: verdict.reasonId, reviewer: reviewer.id });
        }
    }
}

/** One round. Returns how many items were handed over. */
export async function runReviewRound(): Promise<number> {
    if (running) return 0;
    running = true;
    try {
        const reviewer = await activeReviewer();
        if (!reviewer) return 0;
        const capacity = capacityOf(await reviewer.impl.capacity());
        const kinds = await reviewableKinds(capacity);
        if (kinds.length === 0) return 0;
        const reasons = new Set((await prisma.moderationReason.findMany({ where: { enabled: true }, select: { id: true } })).map((r) => r.id));

        let left = capacity.perRun;
        let handed = 0;
        for (const kind of kinds) {
            if (left <= 0) break;
            const items = await candidates(kind, left, capacity.maxAttempts);
            left -= items.length;
            for (let i = 0; i < items.length; i += capacity.batchSize) {
                const batch = items.slice(i, i + capacity.batchSize);
                handed += batch.length;
                let verdicts: ReviewVerdict[];
                try {
                    verdicts = await reviewer.impl.review(batch);
                } catch (err) {
                    log.warn("[moderation] the reviewer could not judge a batch", { reviewer: reviewer.id, kind: kind.id, items: batch.length, error: errorText(err) });
                    for (const item of batch) await record(item, reviewer.id, "failed");
                    continue;
                }
                await apply(kind, reviewer, batch, verdicts, reasons);
            }
        }
        return handed;
    } finally {
        running = false;
    }
}
