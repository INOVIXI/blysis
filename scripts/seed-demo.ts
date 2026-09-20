/**
 * Fill an install with data worth looking at.
 *
 * An empty site answers every question with "nothing here yet", which is the
 * one state nobody needs to test. Pagination, ordering, truncation, a name
 * too long for its column, a list that has to scroll, empty against failed -
 * none of them show up until there is data, and putting one row in each table
 * by hand shows even less than none.
 *
 * Each module owns its own demo data in `seed.ts` beside its `module.json`,
 * because core may not name a module. This finds those files, orders them by
 * what they say they need, and runs them against a context that hands over
 * accounts, deterministic randomness and a writer that remembers what it
 * wrote.
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts                    every installed module
 *   npx tsx scripts/seed-demo.ts --module blog      one module, and what it needs
 *   npx tsx scripts/seed-demo.ts --scale 10         more of everything
 *   npx tsx scripts/seed-demo.ts --clean            take back what it wrote
 *   npx tsx scripts/seed-demo.ts --list             what can be seeded
 *
 * Nothing here belongs anywhere near a production database, so it refuses to
 * run against one without being told twice.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { ModuleSeed, SeedContext, SeededUser } from "@/core/sdk/seed";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";

const ROOT = process.cwd();
const INSTALLED = path.join(ROOT, "src/modules");
const SOURCES = path.join(ROOT, "module-sources");

/** The email domain every demo account shares. Reserved by RFC 2606. */
const DEMO_DOMAIN = "demo.invalid";
const DEMO_PASSWORD = "demo1234";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function option(name: string): string | null {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? null : (process.argv[at + 1] ?? null);
}

const OPTIONS = {
    only: option("module"),
    scale: Math.max(1, Math.min(50, Number(option("scale") ?? 3))),
    seed: option("seed") ?? "blysis",
    clean: flag("clean"),
    list: flag("list"),
    force: flag("force"),
};

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32, seeded from the string in `--seed`.
 *
 * The same seed has to produce the same site: a screenshot of a broken row is
 * only useful if the row is still there tomorrow, and a rerun that reshuffles
 * everything throws away whatever a reviewer was in the middle of reading.
 */
function randomFrom(seed: string): () => number {
    let state = [...seed].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0x9e3779b9);
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Sentences that read like sentences.
 *
 * Random words make a page that technically has text on it and still cannot
 * be read, so every screen looks equally broken and none of them can be
 * judged. These are deliberately generic - a module that needs its own
 * vocabulary (a product name, a ticket subject) ships its own.
 */
const SENTENCES = [
    "The full list is below, with the dates for each step.",
    "Nothing you already own is affected by this.",
    "If you hit a problem, open a ticket and we will take a look.",
    "This has been on the test server for two weeks.",
    "Thanks to everyone who reported it while it was broken.",
    "The change is live now and needs no action from you.",
    "We will keep the old behaviour for another season.",
    "There is a short outage in the middle of this.",
    "Read the rules page before you take part.",
    "The numbers below come from the last thirty days.",
    "It is smaller than it sounds, and it only affects new accounts.",
    "We tried three versions of this before settling on the one here.",
    "Anything not mentioned here works the way it did yesterday.",
    "This one has been asked for often enough that we finally built it.",
    "The screenshots are from the current build.",
];

const WORDS = (
    "server community player update season reward launch build world event map guild " +
    "quest arena ranked survival creative economy trade market shop crate key rank vip " +
    "moderator staff support ticket report appeal rule change news patch fix release"
).split(" ");

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * What this tool wrote, so `--clean` can take back exactly that.
 *
 * A file rather than a table: this is a development tool and its bookkeeping
 * has no business in the schema every install ships. It is keyed by database,
 * so two checkouts pointed at two databases do not clean each other's rows,
 * and `--clean` checks each row still exists before deleting it - a ledger
 * that outlived a `db:push --force-reset` then simply finds nothing.
 */
interface Ledger {
    database: string;
    rows: { module: string; model: string; id: string }[];
}

const LEDGER_FILE = path.join(ROOT, ".seed-ledger.json");

function databaseKey(): string {
    const url = process.env.DATABASE_URL ?? "";
    return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function readLedger(): Ledger {
    try {
        const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")) as Ledger;
        if (parsed.database === databaseKey() && Array.isArray(parsed.rows)) return parsed;
    } catch {
        // No ledger, or one written against another database. Either way there
        // is nothing here this run may claim to have written.
    }
    return { database: databaseKey(), rows: [] };
}

function writeLedger(ledger: Ledger): void {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Where a module's files are. `src/modules` is what the site actually runs;
 * a tree seeded from `module-sources` (the documented fast path for local
 * work) is the same files, so either answers.
 */
function moduleDir(id: string): string | null {
    for (const base of [INSTALLED, SOURCES]) {
        const dir = path.join(base, id);
        if (fs.existsSync(path.join(dir, "module.json"))) return dir;
    }
    return null;
}

function installedModuleIds(): string[] {
    const base = fs.existsSync(INSTALLED) && fs.readdirSync(INSTALLED).length > 0 ? INSTALLED : SOURCES;
    return fs.readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, "module.json")))
        .map((entry) => entry.name)
        .sort();
}

async function loadSeed(id: string): Promise<ModuleSeed | null> {
    const dir = moduleDir(id);
    if (!dir) return null;
    const file = path.join(dir, "seed.ts");
    if (!fs.existsSync(file)) return null;
    const loaded = (await import(file)) as { seed?: ModuleSeed; default?: ModuleSeed };
    const seed = loaded.seed ?? loaded.default;
    if (!seed || typeof seed.run !== "function") {
        throw new Error(`${id}/seed.ts exports no seed with a run()`);
    }
    return seed;
}

/**
 * Seeds in an order where nothing runs before what it needs.
 *
 * A module naming a need that is not installed is not an error: the store
 * seeds orders whether or not the credits module is there, and a site chooses
 * its own modules. The need is dropped and the seed still runs.
 */
export function inOrder(seeds: Map<string, ModuleSeed>): string[] {
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const done = new Set<string>();

    const visit = (id: string, trail: string[]) => {
        if (done.has(id)) return;
        if (visiting.has(id)) {
            throw new Error(`seeds depend on each other in a circle: ${[...trail, id].join(" -> ")}`);
        }
        visiting.add(id);
        for (const need of seeds.get(id)?.needs ?? []) {
            if (seeds.has(need)) visit(need, [...trail, id]);
        }
        visiting.delete(id);
        done.add(id);
        ordered.push(id);
    };

    for (const id of [...seeds.keys()].sort()) visit(id, []);
    return ordered;
}

// ---------------------------------------------------------------------------
// The context a module's seed is given
// ---------------------------------------------------------------------------

function makeContext(
    prisma: PrismaClient,
    users: SeededUser[],
    me: SeededUser,
    moduleId: string,
    record: (model: string, id: string) => void,
): SeedContext {
    const random = randomFrom(`${OPTIONS.seed}:${moduleId}`);
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const words = (count: number) => Array.from({ length: count }, () => pick(WORDS)).join(" ");
    const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

    return {
        prisma,
        users,
        me,
        scale: OPTIONS.scale,
        int,
        pick,
        some: <T,>(items: readonly T[], count: number): T[] => {
            const pool = [...items];
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            return pool.slice(0, Math.min(count, pool.length));
        },
        chance: (percent: number) => random() * 100 < percent,
        title: () => capitalise(words(int(2, 5))),
        sentence: () => pick(SENTENCES),
        paragraphs: (count: number) =>
            Array.from({ length: count }, () =>
                Array.from({ length: int(2, 4) }, () => pick(SENTENCES)).join(" "),
            ).join("\n\n"),
        // Weighted towards now: a feed where everything landed a year ago
        // looks abandoned, which is its own unrepresentative state.
        daysAgo: (days: number) => new Date(Date.now() - Math.floor(random() ** 2 * days * 86_400_000)),
        create: async <T extends { id: string }>(model: string, write: () => Promise<T>): Promise<T> => {
            const row = await write();
            record(model, row.id);
            return row;
        },
        log: (message: string) => console.log(`   ${message}`),
    };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const NAMES = [
    "aeryn", "bolt", "cinder", "dusk", "ember", "fenrir", "glint", "harrow", "ione", "jetstream",
    "kestrel", "lumen", "mirth", "nox", "onyx", "pike", "quill", "rune", "saffron", "tundra",
    "umber", "vesper", "wisp", "xeno", "yarrow", "zephyr", "brack", "corvid", "delve", "estuary",
];

/**
 * The twelve faces in `public/demo`, handed out in order.
 *
 * A community site draws an avatar beside every post, comment, profile and
 * staff card. Left null they all fall back to the same initial, which makes a
 * seeded forum look like one person talking to themselves and hides the one
 * thing a reader checks first: whether two rows are two people.
 */
const AVATARS = [
    "/demo/avatar-01.svg", "/demo/avatar-02.svg", "/demo/avatar-03.svg", "/demo/avatar-04.svg",
    "/demo/avatar-05.svg", "/demo/avatar-06.svg", "/demo/avatar-07.svg", "/demo/avatar-08.svg",
    "/demo/avatar-09.svg", "/demo/avatar-10.svg", "/demo/avatar-11.svg", "/demo/avatar-12.svg",
];

/**
 * What the site calls itself, for an install that has never been through the
 * setup wizard.
 *
 * `site_description` is what every page falls back to and what the home page
 * has instead of a description of its own, and the wizard leaves it optional,
 * so a demo seeded straight into an empty database served a home page with no
 * meta description at all. Only filled in when it is missing: an operator who
 * has written their own words keeps them.
 */
async function seedSiteIdentity(prisma: PrismaClient): Promise<void> {
    const defaults: Record<string, string> = {
        site_name: "Blysis",
        site_description: "A modular community platform: forums, a store, support tickets and everything else, in one place.",
    };
    for (const [key, value] of Object.entries(defaults)) {
        const existing = await prisma.setting.findUnique({ where: { key } });
        const current = typeof existing?.value === "string" ? existing.value : "";
        if (current.trim()) continue;
        await prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
    }
}

/**
 * The people the rest of the data belongs to.
 *
 * Every module hangs its rows on a user, so this runs first and is the one
 * piece of seeding core owns. Accounts are upserted by email, so a rerun
 * finds the same people rather than a second set of them.
 */
async function seedUsers(
    prisma: PrismaClient,
    record: (model: string, id: string) => void,
): Promise<SeededUser[]> {
    const roles = await prisma.role.findMany({ orderBy: { priority: "desc" } });
    if (roles.length === 0) throw new Error("no roles: run `npm run db:seed` first");
    const member = roles.find((r) => r.isDefault) ?? roles[roles.length - 1];
    const staff = roles.filter((r) => r.priority > 0);

    const wanted = Math.min(NAMES.length, 6 + OPTIONS.scale * 4);
    const password = await bcrypt.hash(DEMO_PASSWORD, 10);
    const users: SeededUser[] = [];

    /*
     * A member's roles are the rows in `UserRole`; `roleId` is the one shown
     * beside their name and nothing reads it to decide what they may do.
     * Setting only that made seeded staff who hold no permissions at all -
     * the same way it made an administrator who could not open the panel.
     */
    const hold = async (userId: string, roleId: string) => {
        await prisma.userRole.upsert({
            where: { userId_roleId: { userId, roleId } },
            update: {},
            create: { userId, roleId, source: "seed" },
        });
    };

    /*
     * The two accounts a public demo hands out.
     *
     * Named rather than drawn from the list below, because a visitor is told
     * them on the sign-in screen and they have to be the same tomorrow. One
     * opens the panel and one is an ordinary member, so both halves of the
     * product can be looked at without anybody being given the panel who did
     * not ask for it.
     */
    const admin = roles.find((r) => r.name === "admin") ?? staff[0] ?? member;
    for (const [username, role] of [["demo", admin], ["member", member]] as const) {
        const email = `${username}@${DEMO_DOMAIN}`;
        const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        const user = await prisma.user.upsert({
            where: { email },
            update: { roleId: role.id },
            create: { email, username, password, roleId: role.id, emailVerified: new Date() },
            select: { id: true, username: true, email: true },
        });
        if (!existing) record("user", user.id);
        await hold(user.id, role.id);
        users.push({ ...user, rolePriority: role.priority });
    }

    for (let i = 0; i < wanted; i++) {
        const username = NAMES[i];
        const email = `${username}@${DEMO_DOMAIN}`;
        // The first few carry the staff roles so moderation screens, staff
        // badges and permission-gated pages have someone to show.
        const role = i < staff.length ? staff[i] : member;
        const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        const user = await prisma.user.upsert({
            where: { email },
            update: { roleId: role.id, avatar: AVATARS[i % AVATARS.length] },
            create: {
                email,
                username,
                password,
                avatar: AVATARS[i % AVATARS.length],
                roleId: role.id,
                emailVerified: new Date(),
                createdAt: new Date(Date.now() - (wanted - i) * 86_400_000),
            },
            select: { id: true, username: true, email: true },
        });
        if (!existing) record("user", user.id);
        await hold(user.id, role.id);
        users.push({ ...user, rolePriority: role.priority });
    }
    return users;
}

/**
 * An inbox with something in it.
 *
 * Messages are core's, so no module seeds them, and nothing else writes a
 * conversation - which left the one screen on a member's account that is
 * nothing but a list with no list on it. The term and the pager above it
 * cannot be judged against an empty state, and neither can the unread badge,
 * the read receipt or the reply box.
 *
 * Every thread is with the operator, because that is the account the inbox
 * will be read from. A few are left unread: `lastReadAt` is what the badge
 * counts against, and a list where every row is read shows the badge nowhere.
 */
const OPENERS = [
    "Is the weekend event still on?",
    "Thanks for sorting that out yesterday.",
    "I bought the wrong rank, can you swap it?",
    "Somebody is griefing near spawn.",
    "Any chance of a discount code for the new key?",
    "My licence key stopped working after the update.",
    "Where do I claim what I bought?",
    "Can you look at my appeal when you get a minute?",
    "The store page is showing the old price for me.",
    "Adding a friend to my plot - what is the command?",
    "Got the reward, thank you.",
    "Is there a way to change my display name?",
    "The vote link sends me to a dead page.",
    "Reporting a bug: the chest shows an item twice.",
];

const REPLIES = [
    "Taking a look now.",
    "That one is fixed on the test server already.",
    "Give it an hour and try again.",
    "Sorted - let me know if it comes back.",
    "Thanks for reporting it.",
    "I have passed it to whoever owns that part.",
];

async function seedConversations(
    prisma: PrismaClient,
    users: SeededUser[],
    me: SeededUser,
    record: (model: string, id: string) => void,
): Promise<number> {
    const withMe = users.filter((user) => user.id !== me.id).slice(0, OPENERS.length);
    let written = 0;

    for (const [index, other] of withMe.entries()) {
        // One thread per pair, which is the rule the app itself follows when
        // somebody starts a conversation with a person they have written to
        // before. A rerun finds it and leaves it alone.
        const existing = await prisma.conversation.findFirst({
            where: {
                AND: [
                    { participants: { some: { userId: me.id } } },
                    { participants: { some: { userId: other.id } } },
                ],
            },
            select: { id: true },
        });
        if (existing) continue;

        const opened = new Date(Date.now() - (index + 1) * 36 * 3_600_000);
        const conversation = await prisma.conversation.create({
            data: {
                participants: {
                    create: [
                        // Every third thread is left unread, so the badge and
                        // the bold row have somewhere to appear.
                        { userId: me.id, lastReadAt: index % 3 === 0 ? null : new Date() },
                        { userId: other.id, lastReadAt: new Date() },
                    ],
                },
                createdAt: opened,
            },
        });
        record("conversation", conversation.id);

        const lines: { authorId: string; body: string; createdAt: Date }[] = [
            { authorId: other.id, body: OPENERS[index], createdAt: opened },
            { authorId: me.id, body: REPLIES[index % REPLIES.length], createdAt: new Date(opened.getTime() + 600_000) },
        ];
        if (index % 2 === 0) {
            lines.push({
                authorId: other.id,
                body: "Appreciated, thank you.",
                createdAt: new Date(opened.getTime() + 1_200_000),
            });
        }

        for (const line of lines) {
            const message = await prisma.message.create({
                data: { conversationId: conversation.id, ...line },
            });
            record("message", message.id);
            written += 1;
        }

        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: lines[lines.length - 1].createdAt },
        });
    }

    return written;
}

/**
 * Whose own screens this run should fill.
 *
 * `--clean` takes these rows back like any other, and the tool already
 * refuses a production database without being told twice, so writing onto a
 * real account here is a development convenience rather than a surprise.
 *
 * The site's own administrator, highest role first, and never a demo account:
 * an operator seeds a site so they can look at it, and the account they look
 * at it with is their own. A database with no staff account outside the demo
 * set falls back to the first demo account, which is an admin by
 * construction.
 */
async function whoIsLookingAtThis(prisma: PrismaClient, demo: SeededUser[]): Promise<SeededUser> {
    const real = await prisma.user.findFirst({
        where: {
            email: { not: { endsWith: `@${DEMO_DOMAIN}` } },
            role: { priority: { gt: 0 } },
        },
        // Two administrators tie on priority, and a tie broken by whatever
        // the database felt like returning seeds a different account on
        // different runs. The oldest of them is the one who set the site up.
        orderBy: [{ role: { priority: "desc" } }, { createdAt: "asc" }],
        select: { id: true, username: true, email: true, role: { select: { priority: true } } },
    });
    if (!real) return demo[0];
    return {
        id: real.id,
        username: real.username,
        email: real.email,
        rolePriority: real.role?.priority ?? 0,
    };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function describeDatabase(): string {
    try {
        const url = new URL(process.env.DATABASE_URL ?? "");
        return `${url.hostname}:${url.port || 5432}${url.pathname}`;
    } catch {
        return "(unreadable DATABASE_URL)";
    }
}

async function clean(prisma: PrismaClient): Promise<void> {
    const ledger = readLedger();
    if (ledger.rows.length === 0) {
        console.log("Nothing written by this tool against this database.");
        return;
    }
    let removed = 0;
    // Newest first: a row written later may point at one written earlier.
    for (const row of [...ledger.rows].reverse()) {
        const delegate = (prisma as unknown as Record<string, { delete(args: unknown): Promise<unknown> }>)[row.model];
        if (!delegate?.delete) continue;
        try {
            await delegate.delete({ where: { id: row.id } });
            removed += 1;
        } catch {
            // Already gone, or taken with its parent by a cascade. Either way
            // it is not there any more, which is what was asked for.
        }
    }
    writeLedger({ database: databaseKey(), rows: [] });
    console.log(`Removed ${removed} of ${ledger.rows.length} rows.`);
}

async function main(): Promise<void> {
    const seeds = new Map<string, ModuleSeed>();
    for (const id of installedModuleIds()) {
        const seed = await loadSeed(id);
        if (seed) seeds.set(id, seed);
    }

    if (OPTIONS.list) {
        console.log(`${seeds.size} module(s) ship demo data:\n`);
        for (const id of inOrder(seeds)) {
            const needs = seeds.get(id)?.needs?.filter((n) => seeds.has(n)) ?? [];
            console.log(`  ${id}${needs.length ? `  (after ${needs.join(", ")})` : ""}`);
        }
        return;
    }

    if (process.env.NODE_ENV === "production" && !OPTIONS.force) {
        throw new Error("NODE_ENV is production. This writes made-up data; pass --force if you meant it.");
    }

    // A seed that asks another module something - what may be handed over,
    // what a shelf holds - gets its own argument back on a bus nobody filled,
    // and the tell is a prize that silently seeds as `nothing`. Every script
    // process is its own module graph, so it is filled here rather than by
    // whichever seed happens to ask first.
    await ensureHooks();

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    console.log(`Database: ${describeDatabase()}\n`);

    try {
        if (OPTIONS.clean) {
            await clean(prisma);
            return;
        }

        const ledger = readLedger();
        const record = (module: string) => (model: string, id: string) => {
            ledger.rows.push({ module, model, id });
        };

        await seedSiteIdentity(prisma);
        const users = await seedUsers(prisma, record("core"));
        const operator = await whoIsLookingAtThis(prisma, users);
        const messages = await seedConversations(prisma, users, operator, record("core"));
        console.log(`core: ${users.length} accounts (password ${DEMO_PASSWORD})`);
        console.log(`      personal screens seeded for ${operator.username}, ${messages} messages`);

        let toRun = inOrder(seeds);
        if (OPTIONS.only) {
            if (!seeds.has(OPTIONS.only)) {
                throw new Error(`${OPTIONS.only} ships no seed. Try --list.`);
            }
            const wanted = new Set<string>();
            const gather = (id: string) => {
                if (wanted.has(id)) return;
                wanted.add(id);
                for (const need of seeds.get(id)?.needs ?? []) if (seeds.has(need)) gather(need);
            };
            gather(OPTIONS.only);
            toRun = toRun.filter((id) => wanted.has(id));
        }

        for (const id of toRun) {
            const seed = seeds.get(id);
            if (!seed) continue;
            console.log(`${id}:`);
            try {
                await seed.run(makeContext(prisma, users, operator, id, record(id)));
            } catch (err) {
                // One module's seed failing is not a reason to lose the rest,
                // and the ledger is written either way so what it did write
                // can still be cleaned.
                console.error(`   failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        writeLedger(ledger);
        console.log(`\nWrote ${ledger.rows.length} rows. Undo with --clean.`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

/**
 * End the process, once what has been printed is actually out.
 *
 * This tool imports arbitrary module code, and a module's seed may reach a
 * helper that imports the app's own Prisma client, which opens a connection
 * pool the moment it is imported. That pool is nobody's to close from here,
 * and it kept the command alive after its work was done: `--list` printed its
 * list and sat there, and a seeding run left a process behind that was still
 * running a day later. The tool owns its own exit rather than depending on
 * ninety modules importing nothing that holds a socket.
 *
 * Draining first because a write to a pipe is asynchronous, and `process.exit`
 * drops whatever is still queued - which is the whole output when the command
 * is being read by another program.
 */
function exitWhenWritten(code: number): void {
    process.stdout.write("", () => process.exit(code));
}

// Imported by its test for `inOrder`; only the command line runs the rest.
if (process.argv[1] && process.argv[1].endsWith("seed-demo.ts")) {
    main().then(
        () => exitWhenWritten(0),
        (err) => {
            console.error(err instanceof Error ? err.message : err);
            exitWhenWritten(1);
        },
    );
}
