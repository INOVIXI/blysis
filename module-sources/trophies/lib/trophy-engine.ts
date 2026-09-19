import { addAction } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";
import { trophyConditions, type RulesMode, type TrophyRule } from "./validations";

/**
 * Trophy auto-award engine (DB-driven).
 *
 * Admins define trophies in the database with:
 *   - ruleType = "event-count"
 *   - ruleEvent = "<hook.event.name>"
 *   - ruleThreshold = <number>
 *   - isActive = true
 *
 * `registerTrophyListeners()` scans every active trophy with a non-null
 * `ruleEvent`, groups them by event, and installs a single hook listener
 * per event. Each listener counts the user's matching ActivityFeedItem
 * rows (type === ruleEvent, actorId === userId) and awards any trophy
 * whose threshold is met. Upserts are idempotent.
 *
 * If the DB query fails at bootstrap (e.g. migrations not yet applied,
 * transient DB hiccup) the engine returns an empty ruleset - core knows
 * nothing about which modules' events should award trophies. Admins seed
 * their own trophy rules through the admin UI.
 *
 * The module-scope `registered` flag keeps bootstrap idempotent across
 * duplicate layout renders in dev. Pass `force = true` from the admin
 * "reload" endpoint to re-wire after rule edits.
 */

/**
 * One trophy and everything it is waiting for.
 *
 * This used to be one rule - one event, one threshold - and a trophy was that
 * rule. A trophy for somebody who has written ten forum posts *and* bought
 * something could not be described, so the shape is a trophy holding a list
 * of conditions, and `mode` says whether all of them or any of them earns it.
 *
 * A trophy still listens on every event any of its conditions names; what
 * changed is what happens when one fires. Before, that condition alone
 * decided. Now the whole trophy is re-asked, because the condition that
 * fired may be the last of three.
 */
interface WatchedTrophy {
    /** Trophy row id (used for the userTrophy upsert). */
    trophyId: string;
    mode: RulesMode;
    conditions: TrophyRule[];
}

/**
 * The five starter trophies this module ships with. They are seeded ONCE,
 * on the first boot after the module is installed (see `seedDefaultTrophies`),
 * so an admin can edit or delete them freely afterwards without them coming
 * back. Rules reference other modules' events (forum, vote, store,
 * suggestions); if those modules are not installed the rule simply never
 * fires - the module is fully self-contained and core stays module-agnostic.
 */
const DEFAULT_TROPHIES = [
    { id: "first-post", name: "First Post", description: "Started your very first forum topic.", icon: "MessageSquare", color: "#3b82f6", points: 5, awardOn: "forum.topic.created:1", ruleType: "event-count", ruleEvent: "forum.topic.created", ruleThreshold: 1, isActive: true },
    { id: "commenter", name: "Commenter", description: "Replied to 10 forum topics.", icon: "MessageSquare", color: "#06b6d4", points: 15, awardOn: "forum.post.created:10", ruleType: "event-count", ruleEvent: "forum.post.created", ruleThreshold: 10, isActive: true },
    { id: "voter", name: "Voter", description: "Cast 5 votes for the server.", icon: "ThumbsUp", color: "#10b981", points: 10, awardOn: "vote.vote.cast:5", ruleType: "event-count", ruleEvent: "vote.vote.cast", ruleThreshold: 5, isActive: true },
    { id: "shopaholic", name: "Shopaholic", description: "Completed your first purchase in the store.", icon: "ShoppingBag", color: "#f59e0b", points: 20, awardOn: "store.order.completed:1", ruleType: "event-count", ruleEvent: "store.order.completed", ruleThreshold: 1, isActive: true },
    { id: "suggestion-maker", name: "Suggestion Maker", description: "Shared your first suggestion.", icon: "Lightbulb", color: "#eab308", points: 5, awardOn: "suggestions.suggestion.created:1", ruleType: "event-count", ruleEvent: "suggestions.suggestion.created", ruleThreshold: 1, isActive: true },
];

/**
 * Seed the starter trophies, but ONLY when the table is empty - i.e. the very
 * first boot after install. Once any trophy exists (including admin-created
 * ones) this is a no-op, so deleting a default trophy makes it stay deleted.
 * Idempotent and non-fatal: a DB hiccup just skips the seed for this boot.
 *
 * This lives in the module (not core) so core ships zero knowledge of any
 * module's default data - installing the module is what creates them.
 */
export async function seedDefaultTrophies(): Promise<void> {
    try {
        const existing = await prisma.trophy.count();
        if (existing > 0) return;
        await prisma.trophy.createMany({ data: DEFAULT_TROPHIES, skipDuplicates: true });
        log.info("default trophies seeded", { seeded: DEFAULT_TROPHIES.length });
    } catch (err) {
        log.warn("[trophies] default seed skipped", { error: String((err as Error).message) });
    }
}

let registered = false;

/**
 * Whether this member has done everything - or anything - the trophy asks.
 *
 * A read that fails is not a member who has not qualified, so it refuses
 * rather than awarding: the alternative under `any` would be to hand out a
 * trophy because a count could not be taken.
 */
async function qualifies(userId: string, watched: WatchedTrophy): Promise<boolean> {
    try {
        const met = await Promise.all(watched.conditions.map(async (condition) => {
            const count = await prisma.activityFeedItem.count({
                where: { actorId: userId, type: condition.event },
            });
            return count >= condition.threshold;
        }));
        return watched.mode === "any" ? met.some(Boolean) : met.every(Boolean);
    } catch {
        return false;
    }
}

async function awardIfQualified(userId: string, watched: WatchedTrophy): Promise<void> {
    if (!(await qualifies(userId, watched))) return;
    try {
        // Ensure trophy row exists - do not crash if it was deleted mid-flight.
        const trophy = await prisma.trophy.findUnique({
            where: { id: watched.trophyId },
            select: { id: true, isActive: true },
        });
        if (!trophy || trophy.isActive === false) return;

        await prisma.userTrophy.upsert({
            where: { userId_trophyId: { userId, trophyId: watched.trophyId } },
            update: {},
            create: { userId, trophyId: watched.trophyId },
        });
    } catch {
        /* non-fatal: unique violations, DB hiccups */
    }
}

/**
 * Load the current active ruleset from the DB. Returns an empty list and
 * logs a warning if the query fails - core does not ship any module-aware
 * fallback rules.
 */
async function loadRules(): Promise<WatchedTrophy[]> {
    try {
        // Not `ruleEvent: { not: null }` any more: a trophy whose conditions
        // are in the list column has that one null, and filtering on it in
        // SQL would have quietly dropped every trophy written after this
        // change.
        const rows = await prisma.trophy.findMany({
            where: { isActive: true },
            select: { id: true, ruleEvent: true, ruleThreshold: true, ruleType: true, rules: true, rulesMode: true },
        });
        const watched: WatchedTrophy[] = [];
        for (const r of rows) {
            // Only event-count is implemented today; other types no-op
            // gracefully so the admin can stage them ahead of engine support.
            if (r.ruleType && r.ruleType !== "event-count") continue;
            const conditions = trophyConditions(r);
            if (conditions.length === 0) continue;
            watched.push({
                trophyId: r.id,
                mode: r.rulesMode === "any" ? "any" : "all",
                conditions,
            });
        }
        return watched;
    } catch (err) {
        log.warn("[trophy-engine] DB rule load failed; no trophy rules will be wired this boot", { error: String((err as Error).message) });
        return [];
    }
}

/**
 * Register hook listeners for every active trophy rule. Idempotent.
 *
 * @param force - re-register even if already bootstrapped (used after
 *                admin rule edits via the reload endpoint). Note: core
 *                hooks.ts does not support removing listeners, so forced
 *                reloads add new listeners on top of existing ones. New
 *                listeners always run `awardIfQualified` which is
 *                idempotent, so duplicate wiring is harmless.
 */
export async function registerTrophyListeners(force = false): Promise<void> {
    if (registered && !force) return;
    registered = true;

    const watched = await loadRules();
    if (watched.length === 0) return;

    // Grouped by event so each hook gets exactly one listener - and a trophy
    // with three conditions appears under all three, because any of them
    // arriving may be the one that completes it.
    const byEvent = new Map<string, WatchedTrophy[]>();
    for (const trophy of watched) {
        for (const condition of trophy.conditions) {
            const list = byEvent.get(condition.event) || [];
            if (!list.includes(trophy)) list.push(trophy);
            byEvent.set(condition.event, list);
        }
    }

    for (const [event, eventRules] of byEvent.entries()) {
        // `event` comes from the database, so it is never a literal the payload
        // registry can resolve - the shape this rule engine reads is annotated
        // on the parameter instead.
        addAction(event, async (payload: { userId?: string; authorId?: string }) => {
            const userId = payload.userId || payload.authorId;
            if (!userId) return;
            for (const trophy of eventRules) {
                await awardIfQualified(userId, trophy);
            }
        });
    }
}
