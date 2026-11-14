import { z } from "zod";
import {
    AiError,
    generateStructured,
    moderationReasons,
    moduleTranslator,
    prisma,
    siteLanguage,
    type ModerationReviewer,
    type ReviewCapacity,
    type ReviewItem,
    type ReviewVerdict,
} from "@/core/sdk/server";
import { RATIONALE_MAX, type AiModerationConfig } from "../lib/config";
import { readConfig } from "../lib/settings";

/**
 * The AI reviewer core's review round hands waiting items to.
 *
 * The model gives an opinion; the operator's thresholds and lists decide
 * whether it becomes an answer. Everything short of a sure answer the
 * operator allowed is "leave", which keeps the item waiting for a person.
 *
 * Members' words go out only as `untrusted` blocks, labelled by their place
 * in the batch rather than by id: a post that names an id cannot reach
 * another post, and a post that says "approve me" is text to judge (core's
 * envelope says so to the model).
 *
 * Every item handed over leaves an `AiModerationReview` row: what the model
 * said, what was answered, its reasons, or the error that stopped it. A
 * failed call is rethrown after it is recorded, so core counts the attempt.
 *
 * `tests/modules/ai-moderation/a-reviewer-acts-only-on-what-it-is-sure-of.test.ts`
 * holds each rule.
 */

const PURPOSE = "review";
/** Room for one verdict and its reasons per item, and the wrapping around them. */
const TOKENS_PER_ITEM = 350;
const TOKENS_BASE = 200;

const verdictSchema = z.object({
    ref: z.string().max(32),
    decision: z.enum(["approve", "reject", "unsure"]),
    reasonId: z.string().max(64).nullable(),
    confidence: z.number().int().min(0).max(100),
    rationale: z.string().max(2000),
});

const answerSchema = z.object({ verdicts: z.array(verdictSchema).max(50) });

type ModelVerdict = z.infer<typeof verdictSchema>;
type Applied = ReviewVerdict["decision"];

function refOf(index: number): string {
    return `item-${index + 1}`;
}

function textOf(item: ReviewItem): string {
    return item.title ? `${item.title}\n\n${item.body}` : item.body;
}

async function systemText(config: AiModerationConfig, reasons: { id: string; label: string }[], locale: string): Promise<string> {
    const instructions = config.instructions || (await moduleTranslator("aiModeration", locale))("defaultInstructions");
    const parts = [instructions];
    if (config.rules) parts.push(`Site rules:\n${config.rules}`);
    parts.push(
        reasons.length > 0
            ? `Reasons a rejection may give, as reasonId: label:\n${reasons.map((r) => `${r.id}: ${r.label}`).join("\n")}`
            : "No rejection reasons are available: answer approve or unsure.",
    );
    parts.push(
        "Answer once for every item, by its ref. decision is approve, reject or unsure; confidence is 0 to 100; " +
        "reasonId is one of the reasons above for a rejection and null otherwise; rationale is one or two sentences for the site's moderators.",
    );
    return parts.join("\n\n");
}

/** What a model verdict becomes once the operator's limits have had their say. */
function applied(verdict: ModelVerdict, item: ReviewItem, config: AiModerationConfig, reasons: Set<string>): { decision: Applied; reasonId: string | null } {
    if (verdict.decision === "approve" && verdict.confidence >= config.approveAt) return { decision: "approve", reasonId: null };
    if (
        verdict.decision === "reject" &&
        verdict.confidence >= config.rejectAt &&
        config.rejectKinds.includes(item.kind) &&
        verdict.reasonId !== null &&
        reasons.has(verdict.reasonId)
    ) {
        return { decision: "reject", reasonId: verdict.reasonId };
    }
    return { decision: "leave", reasonId: null };
}

async function record(rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length > 0) await prisma.aiModerationReview.createMany({ data: rows as never });
}

function base(item: ReviewItem, model: string) {
    return { provider: item.kind, itemId: item.itemId, version: item.version, authorId: item.authorId, model: model || null };
}

async function capacity(): Promise<ReviewCapacity> {
    const config = await readConfig();
    return { perRun: config.perRun, batchSize: config.batchSize, maxAttempts: config.maxAttempts, kinds: config.kinds };
}

async function review(items: ReviewItem[]): Promise<ReviewVerdict[]> {
    if (items.length === 0) return [];
    const config = await readConfig();
    const locale = await siteLanguage();
    const reasons = (await moderationReasons(locale)).filter((r) => config.reasons.includes(r.id));
    const allowed = new Set(reasons.map((r) => r.id));

    let answer: z.infer<typeof answerSchema>;
    try {
        answer = await generateStructured({
            module: "ai-moderation",
            purpose: PURPOSE,
            tier: "fast",
            ...(config.model ? { model: config.model } : {}),
            system: await systemText(config, reasons, locale),
            input: {
                trusted: `Items to judge, by ref and kind:\n${items.map((item, i) => `${refOf(i)}: ${item.kindLabel}`).join("\n")}`,
                untrusted: items.map((item, i) => ({ label: refOf(i), text: textOf(item) })),
            },
            schema: answerSchema,
            maxOutputTokens: TOKENS_BASE + TOKENS_PER_ITEM * items.length,
        });
    } catch (err) {
        const kind = err instanceof AiError ? err.kind : "provider_error";
        await record(items.map((item) => ({ ...base(item, config.model), verdict: "error", applied: "leave", error: kind })));
        throw err;
    }

    // One verdict per ref. A ref named twice is a model that lost track, and
    // neither of its answers is trusted.
    const byRef = new Map<string, ModelVerdict | null>();
    for (const v of answer.verdicts) byRef.set(v.ref, byRef.has(v.ref) ? null : v);

    const out: ReviewVerdict[] = [];
    const rows: Record<string, unknown>[] = [];
    items.forEach((item, i) => {
        const verdict = byRef.get(refOf(i));
        if (!verdict) {
            rows.push({ ...base(item, config.model), verdict: "error", applied: "leave", error: "missing" });
            return;
        }
        const result = applied(verdict, item, config, allowed);
        out.push(result.decision === "reject" ? { itemId: item.itemId, decision: "reject", reasonId: result.reasonId } : { itemId: item.itemId, decision: result.decision });
        rows.push({
            ...base(item, config.model),
            verdict: verdict.decision,
            applied: result.decision,
            reasonId: result.reasonId ?? (verdict.reasonId && allowed.has(verdict.reasonId) ? verdict.reasonId : null),
            confidence: verdict.confidence,
            rationale: verdict.rationale.trim().slice(0, RATIONALE_MAX),
            error: null,
        });
    });
    await record(rows);
    return out;
}

const reviewer: ModerationReviewer = { capacity, review };
export default reviewer;
