import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A punishment log with every kind of entry in it, in every state.
 *
 * The public list filters by type, by place and by status, and pages. So the
 * seed writes all of them: permanent and timed, standing and lifted, and
 * spread across the places an operator would actually divide a site into -
 * because a feature that only shows up once somebody configures it is one
 * nobody discovers.
 *
 * The places are the point of the shape. "This site" restricts, because a
 * punishment an administrator hands down here is about here. The two game
 * modes do not, which is the arrangement most sites want and the one that is
 * least obvious from the switch alone: a Skyblock ban is on the record, and
 * the member can still post on the forum.
 *
 * Names come from the demo accounts where it can, because a log full of
 * players nobody has heard of reads as fake even when it is.
 */

/** What a reporting module would call each place. See `scopeKey` on the report. */
const PLACES = [
    { name: "This site", matchKey: null, restrictsSite: true, order: 0 },
    { name: "Survival", matchKey: "survival", restrictsSite: true, order: 1 },
    { name: "Skyblock", matchKey: "skyblock", restrictsSite: false, order: 2 },
] as const;

const REASONS: Record<string, string[]> = {
    ban: ["Cheating - killaura", "Cheating - x-ray", "Ban evasion", "Advertising another server"],
    tempban: ["Griefing spawn", "Repeated toxicity", "Duping items"],
    mute: ["Spam in chat", "Insulting another player", "Advertising in chat"],
    tempmute: ["Caps spam", "Arguing with staff in public chat"],
    kick: ["AFK on a full server", "Warning ignored"],
    warning: ["First offence - mild toxicity", "Building too close to spawn"],
};

const DURATIONS: Record<string, string | null> = {
    ban: null, tempban: "7d", mute: null, tempmute: "12h", kick: null, warning: null,
};

/** Why somebody took one back. Read beside the staff name that took it. */
const LIFT_REASONS = [
    "Appeal upheld",
    "Wrong player",
    "Served long enough",
    "Issued by mistake",
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const scopes = [];
        for (const place of PLACES) {
            scopes.push(await ctx.create("punishmentScope", () => ctx.prisma.punishmentScope.create({
                data: { ...place, isActive: true },
            })));
        }

        const types = Object.keys(REASONS);
        const howMany = 6 * ctx.scale;
        const staff = ctx.users.filter((u) => u.rolePriority > 0);

        for (let i = 0; i < howMany; i++) {
            const type = types[i % types.length];
            const createdAt = ctx.daysAgo(200);
            const temporary = type.startsWith("temp");
            const expiresAt = temporary
                ? new Date(createdAt.getTime() + ctx.int(1, 30) * 86_400_000)
                : null;
            // An expired or lifted punishment is what "active" is there to
            // tell apart, so a quarter of them are not.
            const active = expiresAt ? expiresAt > new Date() : ctx.chance(75);
            // Lifted is not the same as expired: one ran out, the other was
            // taken back by a person, and only that one has a name against it.
            const lifted = !active && expiresAt === null;
            const scope = ctx.pick(scopes);

            await ctx.create("punishment", () => ctx.prisma.punishment.create({
                data: {
                    playerName: ctx.pick(ctx.users).username,
                    type,
                    reason: ctx.pick(REASONS[type]),
                    duration: DURATIONS[type],
                    active,
                    punishedBy: staff.length ? ctx.pick(staff).username : null,
                    createdAt,
                    expiresAt,
                    liftedBy: lifted && staff.length ? ctx.pick(staff).username : null,
                    liftReason: lifted ? ctx.pick(LIFT_REASONS) : null,
                    scopeId: scope.id,
                    // What the reporter would have called it. Kept beside the
                    // scope so the admin screen's "arriving under a name
                    // nobody has claimed" list has the shape it will really
                    // see.
                    scopeKey: scope.matchKey,
                },
            }));
        }

        ctx.log(`${howMany} punishments across ${types.length} types and ${scopes.length} places`);
    },
};
