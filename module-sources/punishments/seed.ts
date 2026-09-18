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
 * A place is something an operator names, so the seed makes only the ones it
 * can honestly name: two game modes. What this website does is not one of
 * them - a punishment handed down here is unscoped, which is what unscoped
 * already means and what every row written before places existed is. Seeding a
 * scope called "This site" would have been the site inventing an operator's
 * word for itself, in one language, on a list read in another.
 *
 * The two modes differ on the switch, which is the part the switch alone does
 * not make obvious: Survival restricts this website and Skyblock does not, so
 * a Skyblock ban is on the record and the member can still post on the forum.
 *
 * A kick is only ever written where a kick means something. It is a game
 * server throwing somebody off a server, and there is nothing on a website to
 * throw them off of - `hooks/standing.ts` says so, and a demo that files one
 * against this site contradicts it on the screen.
 *
 * Names come from the demo accounts where it can, because a log full of
 * players nobody has heard of reads as fake even when it is.
 */

/** What a reporting module would call each place. See `scopeKey` on the report. */
const PLACES = [
    { name: "Survival", matchKey: "survival", restrictsSite: true, order: 1 },
    { name: "Skyblock", matchKey: "skyblock", restrictsSite: false, order: 2 },
] as const;

/**
 * What can happen where.
 *
 * A game server can throw somebody off it; this website has nowhere to throw
 * them. Everything else means something in both.
 */
const OFF_A_SERVER_ONLY = ["kick"];

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
            // A third of them are this site's own, which is what unscoped is.
            const inGame = OFF_A_SERVER_ONLY.includes(type) || ctx.chance(66);
            const createdAt = ctx.daysAgo(200);
            const temporary = type.startsWith("temp");
            const expiresAt = temporary
                ? new Date(createdAt.getTime() + ctx.int(1, 30) * 86_400_000)
                : null;
            /*
             * `active` is not "is it still running". `lib/status.ts` is
             * explicit: it means an administrator revoked this, and expiry is
             * derived from the clock so a temporary punishment ends on a site
             * whose scheduler is not. Writing `active: false` for one that
             * merely ran out is what put "Revoked" on the screen beside a
             * seven-day ban nobody ever touched.
             *
             * So the clock decides expired, a quarter are revoked, and both
             * can be true of the same row - an admin can lift a ban a week
             * before it would have ended.
             */
            const lifted = ctx.chance(25);
            const active = !lifted;
            const scope = inGame ? ctx.pick(scopes) : null;

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
                    scopeId: scope?.id ?? null,
                    // What the reporter would have called it. Kept beside the
                    // scope so the admin screen's "arriving under a name
                    // nobody has claimed" list has the shape it will really
                    // see. Nothing reported the ones written here.
                    scopeKey: scope?.matchKey ?? null,
                },
            }));
        }

        ctx.log(`${howMany} punishments across ${types.length} types, ${scopes.length} places and this site`);
    },
};
