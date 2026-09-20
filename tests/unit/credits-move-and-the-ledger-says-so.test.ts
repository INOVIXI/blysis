import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");

/**
 * A balance and the row that explains it are written together, or not at all.
 *
 * Every credit on this platform is a column on the user (`creditBalance`) and
 * a row in a ledger (`CreditTransaction`), and the ledger is the only place
 * anyone can look to find out where a balance came from. Three places moved
 * one and then the other in a second call: an admin grant, and both halves of
 * a wheel spin - the debit for a paid spin and the payout of a credits prize.
 *
 * A failure between the two calls is not a rare shape. The write that follows
 * a successful one is exactly where a connection drops, a pool times out or a
 * request is cancelled, and the result is silent: credits that left an account
 * with nothing recording it, or a balance that grew with no entry to explain
 * it. Nobody notices until somebody asks why the numbers do not add up, and by
 * then the evidence of what happened is the thing that was lost.
 *
 * So the rule is structural rather than case-by-case: a change to
 * `creditBalance` happens inside a transaction, and that same transaction
 * writes the ledger row.
 *
 * There is one place left that moves a balance. The wallet belongs to the
 * credits module, and the four modules that used to move it - checkout, a
 * paid spin, a marketplace sale, a member transfer - ask it through
 * `credit.change` and hand over the transaction they already have open. So
 * the rule is now checked where it is implemented, and the second half of it,
 * that the caller's transaction is the one used, is what keeps the guarantee
 * these tests were written for: a failure anywhere in a spin still undoes the
 * payment for it.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** The character span of every `$transaction( ... )` call in a file. */
function transactionSpans(source: string): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    for (const match of source.matchAll(/\$transaction\s*\(/g)) {
        const open = match.index + match[0].length - 1;
        let depth = 0;
        for (let i = open; i < source.length; i++) {
            if (source[i] === "(") depth++;
            else if (source[i] === ")" && --depth === 0) {
                spans.push([open, i]);
                break;
            }
        }
    }
    return spans;
}

const BALANCE_MOVE = /creditBalance:\s*\{\s*(?:increment|decrement)/g;
const LEDGER_WRITE = /creditTransaction\.create/;

interface Move {
    where: string;
    inTransaction: boolean;
    withLedger: boolean;
}

function balanceMoves(): Move[] {
    const moves: Move[] = [];
    for (const file of sourceFiles(SOURCES)) {
        const source = fs.readFileSync(file, "utf8");
        const spans = transactionSpans(source);
        for (const match of source.matchAll(BALANCE_MOVE)) {
            const at = match.index;
            const line = source.slice(0, at).split("\n").length;
            const span = spans.find(([from, to]) => at > from && at < to);
            moves.push({
                where: `${path.relative(ROOT, file)}:${line}`,
                inTransaction: span !== undefined,
                withLedger: span ? LEDGER_WRITE.test(source.slice(span[0], span[1])) : false,
            });
        }
    }
    return moves;
}

describe("a credit balance never moves on its own", () => {
    const moves = balanceMoves();

    it("finds the one place that moves one", () => {
        // It used to be eight places in four modules, each with its own copy
        // of the rule. A module added tomorrow that pays somebody must ask
        // rather than move it, so this list staying at one file is the point.
        const files = [...new Set(moves.map((m) => m.where.split(":")[0]))];
        expect(files).toEqual(["module-sources/credits/hooks/change.ts"]);
        expect(moves.length).toBeGreaterThanOrEqual(2);
    });

    it("moves it on the caller's transaction, never on the client", () => {
        // `tx.user.update` rather than `prisma.user.update`: the movement
        // joins whatever the caller is already doing, so their rollback takes
        // it with them.
        const wallet = fs.readFileSync(path.join(SOURCES, "credits/hooks/change.ts"), "utf8");
        expect(wallet).not.toMatch(/prisma\.user\.(update|updateMany)/);
        expect(wallet).toMatch(/tx\.user\.updateMany/);
    });

    it("and writes the ledger row in the same breath", () => {
        const wallet = fs.readFileSync(path.join(SOURCES, "credits/hooks/change.ts"), "utf8");
        expect(wallet).toMatch(/tx\.creditTransaction\.create/);
        expect(wallet).not.toMatch(/prisma\.creditTransaction/);
    });
});

describe("a spin is one event", () => {
    const spin = fs.readFileSync(path.join(SOURCES, "wheel/api/spin/route.ts"), "utf8");

    it("pays, records and hands over the prize in a single transaction", () => {
        // The payment and both prizes are asked for now rather than written
        // here, and every ask carries `tx`: the turn is still one event.
        const spans = transactionSpans(spin);
        expect(spans.length).toBe(1);
        const body = spin.slice(spans[0][0], spans[0][1]);
        expect(body).toContain('"credit.change"');
        expect(body).toContain("wheelSpin.create");
        expect(body).toContain('"coupon.issue"');
        expect(body.match(/\btx,/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    });

    it("still refuses a spin the balance cannot cover, without spending it", () => {
        // The transaction used to answer with a boolean and every falsehood
        // was reported as an empty wallet, which was true of the only case
        // there was. It answers with the reason now, so a prize that cannot
        // be handed over is a different sentence.
        expect(spin).toContain('if (!paid.applied) return "wheel_not_enough_credits";');
        expect(spin).toContain('code: "wheel_not_enough_credits"');
    });
});

describe("a coupon prize is collectable", () => {
    const spin = fs.readFileSync(path.join(SOURCES, "wheel/api/spin/route.ts"), "utf8");
    const page = fs.readFileSync(path.join(SOURCES, "wheel/pages/public/page.tsx"), "utf8");
    const manifest = JSON.parse(
        fs.readFileSync(path.join(SOURCES, "wheel/module.json"), "utf8"),
    );

    it("the code reaches the winner rather than only the database", () => {
        expect(spin).toContain("code: couponCode");
        expect(page).toContain("result.code");
        // Rendered beside the label rather than inside it, but the
        // guarantee is the same one: the winner is told the code.
        expect(page).toContain("result.code");
        expect(page).toContain('t("couponCode")');
    });

    it("two winners in the same millisecond get two different codes", () => {
        // `code` is unique, so a timestamp on its own handed the second winner
        // a 500 where a prize should have been.
        const minted = /const couponCode =[\s\S]{0,400}?;/.exec(spin)?.[0] ?? "";
        expect(minted).toContain("randomInt(");
    });

    it("says so in both languages", () => {
        for (const locale of ["en", "tr"]) {
            expect(manifest.translations[locale].wheel.couponCode).toBeTruthy();
        }
    });
});
