/**
 * Blysis module SDK - demo data.
 *
 * A module that ships a screen ships the data that makes the screen worth
 * looking at. An empty install answers every question with "nothing here
 * yet", which is exactly the state nobody needs to test: it hides pagination,
 * ordering, truncation, empty-vs-failed, and every layout that only breaks
 * once a name is long or a list is forty rows deep.
 *
 * So a module may ship `seed.ts` beside its `module.json`, exporting `seed`.
 * `scripts/seed-demo.ts` finds it, works out what it depends on, and runs it
 * with a context that hands over the accounts, the randomness and the writer.
 *
 * Types only. The seed itself runs outside Next, under tsx, against the
 * merged Prisma client, and the one import here is erased at compile time -
 * so nothing in this file can reach a module's bundle.
 */
import type { PrismaClient } from "@prisma/client";

/** An account the core seed made, for a module to hang its rows on. */
export interface SeededUser {
    id: string;
    username: string;
    email: string;
    /** Highest first: [0] is an admin, the tail are ordinary members. */
    rolePriority: number;
}

/**
 * What a module's seed is given.
 *
 * The randomness is deterministic: the same `--seed` produces the same site,
 * so a screenshot of a bug is reproducible on another machine, and a rerun
 * does not reshuffle everything a reviewer was just looking at.
 */
export interface SeedContext {
    /** The merged client, with every installed module's models on it. */
    prisma: PrismaClient;

    /** Accounts to attribute rows to. Never empty. */
    users: SeededUser[];

    /**
     * The account whoever runs this is signed in as.
     *
     * Every seed wrote its rows onto the made-up accounts, which is right for
     * a forum or a shop - those are screens about other people. It is wrong
     * for every screen that is about *you*: the operator opened their own
     * profile to look at the trophies, the licence keys, the chest and the
     * wallet that had just been seeded, and found the empty state on all four,
     * because none of those rows were theirs.
     *
     * So a seed that writes something a member sees on their own account
     * gives this one a share of it. It is the site's own administrator when
     * there is one, and the first demo account otherwise, so a fresh install
     * with nobody in it still seeds.
     */
    me: SeededUser;

    /**
     * How much to write, as a multiplier on each seed's own idea of "a few".
     * 1 is a handful, 3 is a site that looks lived in, 10 is where pagination
     * and truncation start to matter.
     */
    scale: number;

    /**
     * Write a row and remember it, so `--clean` can take exactly this back
     * out and nothing else. The callback keeps Prisma's own typing at the
     * call site:
     *
     *     const category = await ctx.create("blogCategory", () =>
     *         ctx.prisma.blogCategory.create({ data: { name, slug } }));
     */
    create<T extends { id: string }>(model: string, write: () => Promise<T>): Promise<T>;

    /** Whole numbers, both ends included. */
    int(min: number, max: number): number;
    /** One of them. */
    pick<T>(items: readonly T[]): T;
    /** `count` of them, without repeats, in a shuffled order. */
    some<T>(items: readonly T[], count: number): T[];
    /** True this often, as a percentage. */
    chance(percent: number): boolean;

    /** A title-shaped line of words. */
    title(): string;
    /** A sentence. */
    sentence(): string;
    /** Paragraphs of writing, as Markdown, for a rich-text column. */
    paragraphs(count: number): string;
    /** A moment in the last `days` days, weighted towards recent. */
    daysAgo(days: number): Date;

    log(message: string): void;
}

/** What a module's `seed.ts` exports. */
export interface ModuleSeed {
    /**
     * Module ids whose data this one hangs off - a store order needs
     * products, a forum post needs a topic. The runner orders the seeds by
     * this and refuses a cycle.
     */
    needs?: string[];
    run(ctx: SeedContext): Promise<void>;
}
