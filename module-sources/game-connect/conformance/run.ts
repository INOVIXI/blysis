/**
 * Drives a live site through every scenario of PROTOCOL.md and prints PASS or
 * FAIL for each check. Exit code 1 when any check fails.
 *
 * It needs a site that is set up for it, because a protocol about players and
 * money cannot be exercised without both:
 *
 *   GC_SITE     the site's address, e.g. http://127.0.0.1:3000
 *   GC_TOKEN    a server token made for the run, with "Staff may change credits"
 *               and "Staff may mint vouchers" on. The run says hello with it, so
 *               a game server using the same token is superseded.
 *   GC_PLAYER   id:name of a player linked to a member
 *   GC_OTHER    id:name of a player linked to another member
 *   GC_GAME     the game this server says it runs, as its client would say it
 *   GC_PRODUCT  a product shown in game, giftable, with a command that runs on
 *               the token's server and waits for the player to be online
 *   GC_RECORD   optional: a folder to write every exchange to, one JSON file per
 *               scenario. A client replays those files as its fake site.
 *
 * The run moves credits: it adds what it spends to GC_PLAYER through the staff
 * call first, so the member ends where they began, less what the gifts and
 * deliveries cost. Run it against a test site, never a live store.
 *
 *   npx tsx module-sources/game-connect/conformance/run.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Body = { [key: string]: Json };
type Answer = { status: number; body: Body };
type Exchange = {
    method: string;
    path: string;
    request: Json;
    status: number;
    response: Json;
};
type Player = { id: string; name: string };

const env = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set; read the head of this file`);
    return value;
};

const playerOf = (value: string): Player => {
    const at = value.indexOf(":");
    if (at < 1) throw new Error(`"${value}" is not id:name`);
    return { id: value.slice(0, at), name: value.slice(at + 1) };
};

const SITE = env("GC_SITE").replace(/\/+$/, "");
const BASE = `${SITE}/api/v1/game-connect`;
const TOKEN = env("GC_TOKEN");
const PLAYER = playerOf(env("GC_PLAYER"));
const OTHER = playerOf(env("GC_OTHER"));
const PRODUCT = env("GC_PRODUCT");
const GAME = env("GC_GAME");
const RECORD = process.env.GC_RECORD ?? "";
const RUN = crypto.randomBytes(4).toString("hex");
const STRANGER: Player = {
    id: crypto.randomUUID(),
    name: `Conf${RUN.slice(0, 6)}`,
};

let instance = crypto.randomUUID();
let cursor: string | null = null;
let failures = 0;

/** The report is this tool's output, read by whoever ran it, so it goes to standard output and not to a log. */
const say = (line: string) => process.stdout.write(`${line}\n`);
let exchanges: Exchange[] = [];
const seenEvents: Body[] = [];

const key = (what: string) => `conf-${RUN}-${what}`;

async function call(
    method: "GET" | "POST",
    route: string,
    body: Body | null,
    headers: Record<string, string> = {},
    timeoutSeconds = 40,
): Promise<Answer> {
    const sent = body === null ? null : { instance, ...body };
    const response = await fetch(`${BASE}/${route}`, {
        method,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "X-Game-Connect-Protocol": "1",
            ...(sent === null ? {} : { "Content-Type": "application/json" }),
            ...headers,
        },
        body: sent === null ? undefined : JSON.stringify(sent),
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    const text = await response.text();
    const parsed: Body = text ? (JSON.parse(text) as Body) : {};
    exchanges.push({
        method,
        path: route,
        request: sent,
        status: response.status,
        response: text ? parsed : null,
    });
    return { status: response.status, body: parsed };
}

const post = (route: string, body: Body = {}) => call("POST", route, body);

function check(scenario: string, what: string, passed: boolean, seen?: unknown) {
    if (passed) {
        say(`PASS ${scenario}: ${what}`);
        return;
    }
    failures++;
    say(`FAIL ${scenario}: ${what}${seen === undefined ? "" : ` (saw ${JSON.stringify(seen)})`}`);
}

/** A refusal is the status and the stable code, and every error carries a sentence for a log. */
function refused(scenario: string, answer: Answer, status: number, code: string) {
    check(
        scenario,
        `refuses with ${status} ${code}`,
        answer.status === status && answer.body.code === code && typeof answer.body.error === "string",
        { status: answer.status, ...answer.body },
    );
}

function ok(scenario: string, answer: Answer, status = 200) {
    check(scenario, `answers ${status}`, answer.status === status, {
        status: answer.status,
        ...answer.body,
    });
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const list = (value: Json | undefined): Body[] => (Array.isArray(value) ? (value as Body[]) : []);
const field = (value: Json | undefined): Body =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};

async function scenario(name: string, run: () => Promise<void>) {
    exchanges = [];
    try {
        await run();
    } catch (error) {
        check(name, "runs to the end", false, String(error));
    }
    if (RECORD) {
        fs.mkdirSync(RECORD, { recursive: true });
        fs.writeFileSync(
            path.join(RECORD, `${name}.json`),
            `${JSON.stringify({ scenario: name, exchanges }, null, 2)}\n`,
        );
    }
}

/** Asks until the site hands this server the jobs it is waiting for, and settles every other one. */
async function pollFor(scenario: string, wanted: (job: Body) => boolean): Promise<Body[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const answer = await post("poll", cursor === null ? {} : { eventCursor: cursor });
        ok(scenario, answer);
        cursor = typeof answer.body.eventCursor === "string" ? answer.body.eventCursor : cursor;
        seenEvents.push(...list(answer.body.events));
        const jobs = list(answer.body.jobs);
        const found = jobs.filter(wanted);
        const others = jobs.filter((job) => !wanted(job));
        if (others.length > 0) {
            await post("jobs/report", {
                results: others.map((job) => ({
                    id: job.id,
                    outcome: "done",
                    detail: "conformance",
                })),
            });
        }
        if (found.length > 0) return found;
    }
    return [];
}

async function main() {
    await scenario("refusals", async () => {
        const anonymous = await fetch(`${BASE}/hello`, {
            method: "POST",
            headers: {
                "X-Game-Connect-Protocol": "1",
                "Content-Type": "application/json",
            },
            body: "{}",
        });
        const anonymousBody = (await anonymous.json()) as Body;
        exchanges.push({
            method: "POST",
            path: "hello",
            request: {},
            status: anonymous.status,
            response: anonymousBody,
        });
        refused("refusals", { status: anonymous.status, body: anonymousBody }, 401, "token_invalid");

        const wrongToken = await call("POST", "hello", {}, { Authorization: `Bearer gc_${"A".repeat(43)}` });
        refused("refusals", wrongToken, 401, "token_invalid");

        const future = await call("POST", "hello", {}, { "X-Game-Connect-Protocol": "99" });
        refused("refusals", future, 426, "protocol_unsupported");
        check("refusals", "426 lists version 1", list(future.body.supported).includes(1 as never), future.body);

        refused("refusals", await post("hello", { role: "emperor" }), 422, "invalid_request");
    });

    await scenario("hello", async () => {
        const hello = await post("hello", {
            client: { name: "conformance", version: "1" },
            game: GAME,
            software: { name: "Conformance", version: RUN },
            role: "server",
        });
        ok("hello", hello);
        const settings = field(hello.body.settings);
        check("hello", "names the server", typeof field(hello.body.server).name === "string", hello.body.server);
        check("hello", "names the site", typeof field(hello.body.site).name === "string", hello.body.site);
        check(
            "hello",
            "gives the timings",
            isNumber(settings.pollHoldSeconds) &&
                isNumber(settings.statusIntervalSeconds) &&
                isNumber(settings.leaseSeconds),
            settings,
        );
        check("hello", "gives the catalogue version", typeof settings.catalogVersion === "string", settings);
        check(
            "hello",
            "takeover is null or names the previous instance",
            hello.body.takeover === null || typeof field(hello.body.takeover).previousInstance === "string",
            hello.body.takeover,
        );
    });

    await scenario("status", async () => {
        const status = await post("status", {
            online: 1,
            max: 20,
            players: [PLAYER],
            version: "conformance",
            performance: { tps: 20, mspt: 1 },
        });
        ok("status", status, 204);
        refused("status", await post("status", { online: "many" }), 422, "invalid_request");
    });

    await scenario("poll", async () => {
        const first = await post("poll", {});
        ok("poll", first);
        check(
            "poll",
            "answers jobs and events as lists",
            Array.isArray(first.body.jobs) && Array.isArray(first.body.events),
            first.body,
        );
        check("poll", "starts the event cursor", typeof first.body.eventCursor === "string", first.body);
        cursor = typeof first.body.eventCursor === "string" ? first.body.eventCursor : null;
        const leftover = list(first.body.jobs);
        if (leftover.length > 0) {
            await post("jobs/report", {
                results: leftover.map((job) => ({
                    id: job.id,
                    outcome: "done",
                    detail: "conformance",
                })),
            });
        }
    });

    await scenario("catalog", async () => {
        const catalog = await call("GET", "catalog", null);
        ok("catalog", catalog);
        const products = list(catalog.body.categories).flatMap((category) => list(category.products));
        const product = products.find((one) => one.id === PRODUCT);
        check(
            "catalog",
            "shows GC_PRODUCT",
            product !== undefined,
            products.map((one) => one.id),
        );
        check(
            "catalog",
            "a product has a price, a gift switch and its fields",
            product !== undefined &&
                isNumber(product.price) &&
                typeof product.giftable === "boolean" &&
                Array.isArray(product.fields),
            product,
        );
        const again = await call("GET", "catalog", null, {
            "If-None-Match": `"${String(catalog.body.version)}"`,
        });
        check("catalog", "answers 304 to the version it gave", again.status === 304, again.status);
    });

    await scenario("profile", async () => {
        const linked = await post("player/profile", { player: PLAYER });
        ok("profile", linked);
        const member = field(linked.body.member);
        check(
            "profile",
            "a linked player has a member with a balance",
            linked.body.linked === true && isNumber(member.balance) && typeof member.receiveGifts === "boolean",
            linked.body,
        );
        const stranger = await post("player/profile", { player: STRANGER });
        check(
            "profile",
            "a stranger is not linked and has no member",
            stranger.body.linked === false && stranger.body.member === undefined,
            stranger.body,
        );
        refused("profile", await post("player/profile", { player: { id: PLAYER.id } }), 422, "invalid_request");
    });

    await scenario("link", async () => {
        const started = await post("link/start", { player: STRANGER });
        ok("link", started);
        check(
            "link",
            "gives a code, a url and an expiry",
            typeof started.body.code === "string" &&
                String(started.body.url).includes(String(started.body.code)) &&
                typeof started.body.expiresAt === "string",
            started.body,
        );
        refused("link", await post("link/start", { player: PLAYER }), 409, "already_linked");
        refused("link", await post("link/verify", { player: STRANGER, code: "AAAA-AAAA" }), 409, "code_invalid");
    });

    let balance = 0;
    await scenario("credits-admin", async () => {
        const shown = await post("credits/admin", {
            actor: PLAYER,
            target: PLAYER.name,
            operation: "show",
            amount: 0,
        });
        ok("credits-admin", shown);
        check(
            "credits-admin",
            "show names the member and the balance",
            typeof shown.body.target === "string" && isNumber(shown.body.balance),
            shown.body,
        );
        const before = Number(shown.body.balance);
        const add = {
            actor: PLAYER,
            target: PLAYER.name,
            operation: "add",
            amount: 30,
            idempotencyKey: key("add"),
        };
        const added = await post("credits/admin", add);
        check(
            "credits-admin",
            "add raises the balance",
            added.status === 200 && added.body.balance === before + 30,
            added.body,
        );
        const retried = await post("credits/admin", add);
        check(
            "credits-admin",
            "a retried key answers the first answer and adds nothing",
            retried.status === 200 && retried.body.balance === before + 30,
            retried.body,
        );
        balance = before + 30;
        refused(
            "credits-admin",
            await post("credits/admin", {
                ...add,
                amount: -5,
                idempotencyKey: key("negative"),
            }),
            409,
            "amount_invalid",
        );
        refused(
            "credits-admin",
            await post("credits/admin", {
                ...add,
                operation: "remove",
                amount: balance + 1000,
                idempotencyKey: key("below"),
            }),
            409,
            "insufficient_balance",
        );
        refused(
            "credits-admin",
            await post("credits/admin", {
                ...add,
                target: `nobody${RUN}`,
                idempotencyKey: key("nobody"),
            }),
            409,
            "recipient_unknown",
        );
    });

    await scenario("credits-transfer", async () => {
        const send = {
            player: PLAYER,
            to: OTHER.name,
            amount: 1,
            idempotencyKey: key("send"),
        };
        const sent = await post("credits/transfer", send);
        check(
            "credits-transfer",
            "moves the amount and gives the new balance",
            sent.status === 200 &&
                sent.body.sent === 1 &&
                typeof sent.body.to === "string" &&
                sent.body.balance === balance - 1,
            sent.body,
        );
        const retried = await post("credits/transfer", send);
        check(
            "credits-transfer",
            "a retried key moves nothing again",
            retried.status === 200 && retried.body.balance === balance - 1,
            retried.body,
        );
        balance -= 1;
        refused(
            "credits-transfer",
            await post("credits/transfer", {
                ...send,
                to: PLAYER.name,
                idempotencyKey: key("self"),
            }),
            409,
            "same_account",
        );
        refused(
            "credits-transfer",
            await post("credits/transfer", {
                ...send,
                amount: 0,
                idempotencyKey: key("zero"),
            }),
            409,
            "amount_invalid",
        );
        refused(
            "credits-transfer",
            await post("credits/transfer", {
                ...send,
                amount: 0.001,
                idempotencyKey: key("fraction"),
            }),
            409,
            "amount_invalid",
        );
        refused(
            "credits-transfer",
            await post("credits/transfer", {
                ...send,
                amount: balance + 1000,
                idempotencyKey: key("broke"),
            }),
            409,
            "insufficient_balance",
        );
        refused(
            "credits-transfer",
            await post("credits/transfer", {
                ...send,
                to: `nobody${RUN}`,
                idempotencyKey: key("nobody"),
            }),
            409,
            "recipient_unknown",
        );
        refused(
            "credits-transfer",
            await post("credits/transfer", {
                ...send,
                player: STRANGER,
                idempotencyKey: key("stranger"),
            }),
            409,
            "not_linked",
        );
        refused(
            "credits-transfer",
            await post("credits/transfer", { ...send, idempotencyKey: "short" }),
            422,
            "invalid_request",
        );
    });

    await scenario("credits-top", async () => {
        for (const [kind, period] of [
            ["balance", "all"],
            ["topups", "month"],
            ["latest", "all"],
        ]) {
            const top = await call("GET", `credits/top?kind=${kind}&period=${period}&limit=10`, null);
            const entries = list(top.body.entries);
            check(
                "credits-top",
                `${kind} ${period} lists ranked entries`,
                top.status === 200 &&
                    Array.isArray(top.body.entries) &&
                    entries.every(
                        (entry) =>
                            isNumber(entry.rank) &&
                            isNumber(entry.amount) &&
                            (entry.name === null || typeof entry.name === "string"),
                    ),
                top.body,
            );
        }
        const wrong = await call("GET", "credits/top?kind=wealth&period=all&limit=10", null);
        refused("credits-top", wrong, 422, "invalid_request");
    });

    await scenario("community-goal", async () => {
        const goal = await call("GET", "community-goal", null);
        ok("community-goal", goal);
        check("community-goal", "says whether a goal runs", typeof goal.body.active === "boolean", goal.body);
        if (goal.body.active === true) {
            check(
                "community-goal",
                "a running goal has its figures",
                isNumber(goal.body.raised) && isNumber(goal.body.goal) && isNumber(goal.body.percent),
                goal.body,
            );
        }
    });

    let orderId = "";
    await scenario("store-purchase", async () => {
        const buy = {
            player: PLAYER,
            productId: PRODUCT,
            quantity: 1,
            fields: {},
            idempotencyKey: key("buy"),
        };
        const bought = await post("store/purchase", buy);
        check(
            "store-purchase",
            "answers the order, the total and the balance",
            bought.status === 200 &&
                typeof bought.body.orderId === "string" &&
                isNumber(bought.body.total) &&
                isNumber(bought.body.balance) &&
                bought.body.gift === false,
            bought.body,
        );
        const retried = await post("store/purchase", buy);
        check(
            "store-purchase",
            "a retried key buys nothing again",
            retried.body.orderId === bought.body.orderId && retried.body.balance === bought.body.balance,
            retried.body,
        );
        orderId = String(bought.body.orderId);
        refused(
            "store-purchase",
            await post("store/purchase", {
                ...buy,
                quantity: 0,
                idempotencyKey: key("none"),
            }),
            409,
            "quantity_invalid",
        );
        refused(
            "store-purchase",
            await post("store/purchase", {
                ...buy,
                productId: `nothing${RUN}`,
                idempotencyKey: key("nothing"),
            }),
            409,
            "not_found",
        );
        refused(
            "store-purchase",
            await post("store/purchase", {
                ...buy,
                player: STRANGER,
                idempotencyKey: key("stranger"),
            }),
            409,
            "not_linked",
        );
        refused(
            "store-purchase",
            await post("store/purchase", {
                ...buy,
                recipient: `nobody${RUN}`,
                idempotencyKey: key("nobody"),
            }),
            409,
            "recipient_unknown",
        );
    });

    await scenario("delivery", async () => {
        const jobs = await pollFor("delivery", (job) => field(job.reference).id === orderId);
        const job = jobs[0];
        check("delivery", "the purchase comes back as a job for this server", job !== undefined, orderId);
        if (job === undefined) return;
        check(
            "delivery",
            "a job names its command, player, group and reference",
            typeof job.command === "string" &&
                typeof field(job.player).name === "string" &&
                typeof job.groupKey === "string" &&
                isNumber(job.sequence) &&
                field(job.reference).kind === "order",
            job,
        );
        const report = {
            results: [
                { id: job.id, outcome: "done", detail: null },
                { id: `nothing${RUN}`, outcome: "done", detail: null },
            ],
        };
        const first = await post("jobs/report", report);
        check(
            "delivery",
            "accepts its own job and leaves out one it does not hold",
            first.status === 200 &&
                list(first.body.accepted).includes(job.id as never) &&
                !list(first.body.accepted).includes(`nothing${RUN}` as never),
            first.body,
        );
        const again = await post("jobs/report", report);
        check(
            "delivery",
            "accepts the same outcome again",
            list(again.body.accepted).includes(job.id as never),
            again.body,
        );
        refused(
            "delivery",
            await post("jobs/report", {
                results: [{ id: job.id, outcome: "maybe" }],
            }),
            422,
            "invalid_request",
        );
    });

    await scenario("gifts", async () => {
        await post("gifts/receive", { player: OTHER, receive: true });
        const gift = {
            player: PLAYER,
            productId: PRODUCT,
            quantity: 1,
            fields: {},
            recipient: OTHER.name,
        };
        const given = await post("store/purchase", {
            ...gift,
            idempotencyKey: key("gift-1"),
        });
        check(
            "gifts",
            "a purchase for another member is a gift",
            given.status === 200 && given.body.gift === true,
            given.body,
        );
        const chest = await post("chest/list", { player: OTHER });
        const waiting = list(chest.body.items).find(
            (item) => item.state === "pending_gift" && item.productId === PRODUCT,
        );
        check(
            "gifts",
            "the gift waits in the recipient's chest, from the buyer",
            waiting !== undefined && typeof waiting.from === "string" && typeof chest.body.receiveGifts === "boolean",
            chest.body,
        );
        const sent = await post("gifts/sent", { player: PLAYER });
        const mine = list(sent.body.items).find((item) => item.id === waiting?.id);
        check(
            "gifts",
            "the buyer sees it among the gifts sent",
            mine !== undefined && mine.state === "pending_gift" && typeof mine.to === "string",
            sent.body,
        );
        const cancel = {
            player: PLAYER,
            itemId: String(waiting?.id),
            idempotencyKey: key("cancel"),
        };
        const cancelled = await post("gifts/cancel", cancel);
        check(
            "gifts",
            "taking it back refunds it",
            cancelled.status === 200 && isNumber(cancelled.body.refunded) && isNumber(cancelled.body.balance),
            cancelled.body,
        );
        refused(
            "gifts",
            await post("gifts/cancel", {
                ...cancel,
                idempotencyKey: key("cancel-again"),
            }),
            409,
            "not_found",
        );

        const second = await post("store/purchase", {
            ...gift,
            idempotencyKey: key("gift-2"),
        });
        ok("gifts", second);
        const next = list((await post("chest/list", { player: OTHER })).body.items).find(
            (item) => item.state === "pending_gift" && item.productId === PRODUCT,
        );
        const take = { player: OTHER, itemId: String(next?.id) };
        const activated = await post("chest/activate", {
            ...take,
            idempotencyKey: key("activate"),
        });
        check(
            "gifts",
            "the recipient accepts it",
            activated.status === 200 && activated.body.ok === true,
            activated.body,
        );
        refused(
            "gifts",
            await post("chest/activate", {
                ...take,
                idempotencyKey: key("activate-again"),
            }),
            409,
            "not_pending",
        );
        refused(
            "gifts",
            await post("gifts/cancel", {
                player: PLAYER,
                itemId: take.itemId,
                idempotencyKey: key("too-late"),
            }),
            409,
            "not_pending",
        );
        const claimed = await post("chest/claim", {
            ...take,
            idempotencyKey: key("claim"),
        });
        check("gifts", "the recipient claims it", claimed.status === 200 && claimed.body.ok === true, claimed.body);
        refused(
            "gifts",
            await post("chest/claim", {
                ...take,
                idempotencyKey: key("claim-again"),
            }),
            409,
            "already_claimed",
        );
    });

    await scenario("gifts-receive", async () => {
        const off = await post("gifts/receive", { player: OTHER, receive: false });
        check(
            "gifts-receive",
            "a member turns gifts off",
            off.status === 200 && off.body.receiveGifts === false,
            off.body,
        );
        const refusedGift = await post("store/purchase", {
            player: PLAYER,
            productId: PRODUCT,
            quantity: 1,
            fields: {},
            recipient: OTHER.name,
            idempotencyKey: key("refused-gift"),
        });
        refused("gifts-receive", refusedGift, 409, "recipient_refuses_gifts");
        const on = await post("gifts/receive", { player: OTHER, receive: true });
        check("gifts-receive", "and on again", on.status === 200 && on.body.receiveGifts === true, on.body);
    });

    await scenario("vouchers", async () => {
        const made = await post("vouchers/create", {
            player: PLAYER,
            amount: 2,
            idempotencyKey: key("voucher"),
        });
        check(
            "vouchers",
            "a voucher takes the amount and names itself",
            made.status === 200 &&
                String(made.body.voucherId).startsWith("gv_") &&
                made.body.amount === 2 &&
                isNumber(made.body.balance),
            made.body,
        );
        const redeem = { player: OTHER, voucherId: String(made.body.voucherId) };
        const redeemed = await post("vouchers/redeem", redeem);
        check(
            "vouchers",
            "whoever uses it is paid",
            redeemed.status === 200 && redeemed.body.amount === 2 && isNumber(redeemed.body.balance),
            redeemed.body,
        );
        const twice = await post("vouchers/redeem", redeem);
        refused("vouchers", twice, 409, "voucher_used");
        check("vouchers", "a used voucher says when", typeof twice.body.usedAt === "string", twice.body);
        refused(
            "vouchers",
            await post("vouchers/redeem", {
                ...redeem,
                voucherId: `gv_nothing${RUN}`,
            }),
            409,
            "not_found",
        );
        refused("vouchers", await post("vouchers/redeem", { ...redeem, player: STRANGER }), 409, "not_linked");
        refused(
            "vouchers",
            await post("vouchers/create", { player: PLAYER, amount: 0, idempotencyKey: key("voucher-zero") }),
            409,
            "amount_invalid",
        );
        const given = await post("vouchers/give", {
            actor: PLAYER,
            amount: 3,
            idempotencyKey: key("give"),
        });
        check(
            "vouchers",
            "staff mint one nobody paid for",
            given.status === 200 && String(given.body.voucherId).startsWith("gv_") && given.body.amount === 3,
            given.body,
        );
    });

    await scenario("events", async () => {
        const told = (event: Body) =>
            event.type === "purchase" && typeof event.id === "string" && typeof event.at === "string";
        if (!seenEvents.some(told)) {
            const answer = await post("poll", cursor === null ? {} : { eventCursor: cursor });
            seenEvents.push(...list(answer.body.events));
            cursor = typeof answer.body.eventCursor === "string" ? answer.body.eventCursor : cursor;
        }
        check("events", "a purchase is told to every server", seenEvents.some(told), seenEvents);
    });

    await scenario("superseded", async () => {
        const old = instance;
        instance = crypto.randomUUID();
        const hello = await post("hello", {
            client: { name: "conformance", version: "1" },
            game: GAME,
            software: { name: "Conformance", version: RUN },
            role: "server",
        });
        check(
            "superseded",
            "a second process is told who came before",
            field(hello.body.takeover).previousInstance === old,
            hello.body.takeover,
        );
        instance = old;
        refused("superseded", await post("poll", {}), 409, "superseded");
    });

    say(failures === 0 ? "\nEvery check passed." : `\n${failures} check(s) failed.`);
    process.exitCode = failures === 0 ? 0 : 1;
}

void main();
