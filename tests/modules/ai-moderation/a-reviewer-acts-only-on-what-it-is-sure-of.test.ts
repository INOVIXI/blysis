// @vitest-environment node
/**
 * The AI reviewer turns a model's opinion into an answer core can apply, and
 * leaves everything else to a person.
 *
 * The model says approve, reject or unsure with a confidence. An approval
 * counts at or above the operator's approve threshold. A rejection counts
 * only at or above the reject threshold, in a kind where the operator lets it
 * reject, with a reason the operator lets it give. Anything short of that is
 * "leave". What members wrote travels as untrusted text labelled by position,
 * so a post cannot name another post's id, and every answer is recorded with
 * the model's reasons for the admin to read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RATIONALE_MAX } from "@/modules/ai-moderation/lib/config";

class AiError extends Error {
    readonly kind: string;
    constructor(kind: string, message?: string) {
        super(message ?? kind);
        this.kind = kind;
    }
}

interface Asked {
    module: string;
    purpose: string;
    tier?: string;
    model?: string;
    system: string;
    input: { trusted?: string; untrusted: { label: string; text: string }[] };
    schema: { safeParse: (v: unknown) => { success: boolean } };
}

let settings: Record<string, unknown> = {};
let asked: Asked[] = [];
let answer: (req: Asked) => unknown = () => ({ verdicts: [] });
const recorded: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    AiError,
    readSettingValues: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settings[k]])),
    siteLanguage: async () => "tr",
    moduleTranslator: async (namespace: string, locale: string) => (key: string) => `${namespace}.${key}@${locale}`,
    moderationReasons: async (locale: string) => [
        { id: "spam", label: `Spam (${locale})` },
        { id: "abuse", label: `Abuse (${locale})` },
    ],
    generateStructured: async (req: Asked) => {
        asked.push(req);
        const out = answer(req);
        if (out instanceof Error) throw out;
        return out;
    },
    prisma: {
        aiModerationReview: {
            createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
                recorded.push(...data);
                return { count: data.length };
            },
        },
    },
}));

const { default: reviewer } = await import("@/modules/ai-moderation/reviewer/index");

function item(n: number, kind = "forum-post") {
    return { kind, kindLabel: "Forum posts", itemId: `id-${n}`, version: `v${n}`, authorId: `u${n}`, title: `Title ${n}`, body: `Body ${n}` };
}

function verdict(ref: string, decision: string, confidence: number, reasonId: string | null = null) {
    return { ref, decision, confidence, reasonId, rationale: `because ${ref}` };
}

beforeEach(() => {
    settings = {
        ai_moderation_reject_kinds: ["forum-post"],
        ai_moderation_reasons: ["spam"],
        ai_moderation_rules: "No advertising.",
    };
    asked = [];
    recorded.length = 0;
    answer = () => ({ verdicts: [] });
});

describe("what the reviewer answers", () => {
    it("approves at or above the approve threshold and leaves below it", async () => {
        settings.ai_moderation_approve_at = 80;
        answer = () => ({ verdicts: [verdict("item-1", "approve", 80), verdict("item-2", "approve", 79)] });
        expect(await reviewer.review([item(1), item(2)])).toEqual([
            { itemId: "id-1", decision: "approve" },
            { itemId: "id-2", decision: "leave" },
        ]);
    });

    it("rejects only at the threshold, in a kind it may reject, with a reason it may give", async () => {
        settings.ai_moderation_reject_at = 90;
        answer = () => ({
            verdicts: [
                verdict("item-1", "reject", 95, "spam"),
                verdict("item-2", "reject", 89, "spam"),
                verdict("item-3", "reject", 99, "abuse"),
                verdict("item-4", "reject", 99, "spam"),
                verdict("item-5", "reject", 99, null),
            ],
        });
        expect(await reviewer.review([item(1), item(2), item(3), item(4, "blog-comment"), item(5)])).toEqual([
            { itemId: "id-1", decision: "reject", reasonId: "spam" },
            { itemId: "id-2", decision: "leave" },
            { itemId: "id-3", decision: "leave" },
            { itemId: "id-4", decision: "leave" },
            { itemId: "id-5", decision: "leave" },
        ]);
    });

    it("never rejects while no kind or no reason is allowed", async () => {
        settings = {};
        answer = () => ({ verdicts: [verdict("item-1", "reject", 100, "spam")] });
        expect(await reviewer.review([item(1)])).toEqual([{ itemId: "id-1", decision: "leave" }]);
    });

    it("leaves what the model was unsure of", async () => {
        answer = () => ({ verdicts: [verdict("item-1", "unsure", 100)] });
        expect(await reviewer.review([item(1)])).toEqual([{ itemId: "id-1", decision: "leave" }]);
    });

    it("says nothing of an item the answer skipped or named twice, so core counts an attempt", async () => {
        answer = () => ({
            verdicts: [
                verdict("item-1", "approve", 100),
                verdict("item-1", "reject", 100, "spam"),
                verdict("item-3", "approve", 100),
                verdict("item-9", "approve", 100),
            ],
        });
        expect(await reviewer.review([item(1), item(2), item(3)])).toEqual([{ itemId: "id-3", decision: "approve" }]);
        for (const id of ["id-1", "id-2"]) {
            expect(recorded.find((r) => r.itemId === id)).toMatchObject({ verdict: "error", applied: "leave", error: "missing" });
        }
    });
});

describe("what the reviewer sends", () => {
    it("sends members' words as untrusted text labelled by position, never by id", async () => {
        await reviewer.review([item(1), item(2)]);
        const [req] = asked;
        expect(req.input.untrusted).toEqual([
            { label: "item-1", text: "Title 1\n\nBody 1" },
            { label: "item-2", text: "Title 2\n\nBody 2" },
        ]);
        expect(JSON.stringify(req)).not.toContain("id-1");
        expect(req.input.trusted).toContain("item-1: Forum posts");
    });

    it("gives the rules, the reasons it may use and the default instructions in the site's language", async () => {
        await reviewer.review([item(1)]);
        const [req] = asked;
        expect(req.system).toContain("aiModeration.defaultInstructions@tr");
        expect(req.system).toContain("No advertising.");
        expect(req.system).toContain("spam: Spam (tr)");
        expect(req.system).not.toContain("abuse");
        expect(req).toMatchObject({ module: "ai-moderation", purpose: "review", tier: "fast" });
        expect(req.model).toBeUndefined();
    });

    it("uses the operator's own instructions and model when set", async () => {
        settings.ai_moderation_instructions = "Be strict.";
        settings.ai_moderation_model = "a-model";
        await reviewer.review([item(1)]);
        expect(asked[0].system).toContain("Be strict.");
        expect(asked[0].system).not.toContain("defaultInstructions");
        expect(asked[0].model).toBe("a-model");
    });

    it("asks for an answer of a shape the model cannot stretch", async () => {
        await reviewer.review([item(1)]);
        const { schema } = asked[0];
        expect(schema.safeParse({ verdicts: [verdict("item-1", "approve", 50)] }).success).toBe(true);
        expect(schema.safeParse({ verdicts: [verdict("item-1", "ban", 50)] }).success).toBe(false);
        expect(schema.safeParse({ verdicts: [verdict("item-1", "approve", 101)] }).success).toBe(false);
    });
});

describe("what the reviewer records", () => {
    it("keeps the model's verdict, what was applied and why, cut to length", async () => {
        answer = () => ({ verdicts: [{ ...verdict("item-1", "reject", 97, "spam"), rationale: "x".repeat(RATIONALE_MAX + 50) }] });
        await reviewer.review([item(1)]);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
            provider: "forum-post", itemId: "id-1", version: "v1", authorId: "u1",
            verdict: "reject", applied: "reject", reasonId: "spam", confidence: 97, error: null,
        });
        expect((recorded[0].rationale as string).length).toBe(RATIONALE_MAX);
    });

    it("records a failed call against each item and throws, so core counts the attempt", async () => {
        answer = () => new AiError("budget_exhausted");
        await expect(reviewer.review([item(1), item(2)])).rejects.toThrow("budget_exhausted");
        expect(recorded.map((r) => [r.itemId, r.verdict, r.applied, r.error])).toEqual([
            ["id-1", "error", "leave", "budget_exhausted"],
            ["id-2", "error", "leave", "budget_exhausted"],
        ]);
    });
});

describe("how much the reviewer takes on", () => {
    it("is the operator's", async () => {
        settings = { ai_moderation_per_run: 7, ai_moderation_batch_size: 3, ai_moderation_max_attempts: 2, ai_moderation_kinds: ["forum-post"] };
        expect(await reviewer.capacity()).toEqual({ perRun: 7, batchSize: 3, maxAttempts: 2, kinds: ["forum-post"] });
    });
});
