import { AiError, generateStructured, log, moduleTranslator, prisma, siteLanguage, siteTimeZone } from "@/core/sdk/server";
import { modeFor, type AiSupportConfig } from "./config";
import { classify, departments, knowledge, knowledgeSources, postReply, priorities, readThread, type DeskThread } from "./desk";
import { answerSchema, outputTokens, sourceLabel, systemText, trustedInput, untrustedInput, type ModelAnswer } from "./prompt";
import { inWindow } from "./schedule";
import { readConfig } from "./settings";
import { termsOf } from "./terms";

/**
 * The support assistant's round, run every minute by `cron/answer.ts`.
 *
 * A listener only writes a job, one per ticket, so a member who writes three
 * times in a minute is answered once. The round takes the jobs that are due,
 * reads each ticket through the tickets module, and either asks the model or
 * lets the job go. What the model says is kept as a draft for staff; it is
 * sent only where every condition for answering on its own holds, and the
 * tickets module refuses it once anybody has spoken since.
 *
 * `tests/modules/ai-support/an-assistant-answers-only-when-sure.test.ts` holds
 * each rule.
 */

const PURPOSE = "reply";
const MINUTE = 60_000;
/** How long a failed call waits before it is tried again, per attempt so far. */
const RETRY_STEP = 5 * MINUTE;
/**
 * How many due jobs one round looks at, per question it may ask the model.
 * The operator's limit counts questions: a ticket let go without one (a
 * department that is off, a ticket closed meanwhile) costs a read, and
 * counting it would let a busy desk's quiet departments hold up the rest.
 */
const LOOK_AHEAD = 20;
const MAX_LOOKED_AT = 500;

let running = false;

/** Ask for an answer to a ticket, now. A ticket already waiting keeps one job. */
export async function enqueue(ticketId: string, now = new Date()): Promise<void> {
    await prisma.aiSupportJob.upsert({
        where: { ticketId },
        create: { ticketId, dueAt: now },
        update: { dueAt: now, attempts: 0 },
    });
}

/** Stop waiting to answer a ticket: staff have spoken. */
export async function forget(ticketId: string): Promise<void> {
    await prisma.aiSupportJob.deleteMany({ where: { ticketId } });
}

export async function runAnswerRound(now = new Date()): Promise<{ handled: number; asked: number }> {
    // One round at a time in a process: a slow model must not let the next
    // minute's round answer the same ticket again.
    if (running) return { handled: 0, asked: 0 };
    running = true;
    try {
        const config = await readConfig();
        const jobs = await prisma.aiSupportJob.findMany({
            where: { dueAt: { lte: now } },
            orderBy: { dueAt: "asc" },
            take: Math.min(config.perRun * LOOK_AHEAD, MAX_LOOKED_AT),
            select: { id: true, ticketId: true, attempts: true, updatedAt: true },
        });
        let handled = 0;
        let asked = 0;
        for (const job of jobs) {
            if (asked >= config.perRun) break;
            handled += 1;
            try {
                if (await answer(job, config, now)) asked += 1;
            } catch (err) {
                // One ticket's failure is not the round's: the next job runs.
                log.error("[ai-support] a ticket could not be answered", { ticketId: job.ticketId, error: err instanceof Error ? err.message : String(err) });
                await drop(job);
            }
        }
        return { handled, asked };
    } finally {
        running = false;
    }
}

interface Job {
    id: string;
    ticketId: string;
    attempts: number;
    /** As the round read it. A member writing meanwhile moves it. */
    updatedAt: Date;
}

/**
 * The job as the round read it, and no later one. A member who writes while
 * the round is asking the model about their last message refreshes the same
 * row; letting the job go by its id alone deleted that new message's request
 * with it, and the member's second message was never answered.
 */
function unchanged(job: Job) {
    return { id: job.id, updatedAt: job.updatedAt };
}

async function drop(job: Job): Promise<false> {
    await prisma.aiSupportJob.deleteMany({ where: unchanged(job) });
    return false;
}

/** Move the job on, unless something newer has moved it already. */
async function reschedule(job: Job, data: { dueAt: Date; attempts?: number }): Promise<void> {
    await prisma.aiSupportJob.updateMany({ where: unchanged(job), data });
}

/** Works one job through; true when it asked the model. */
async function answer(job: Job, config: AiSupportConfig, now: Date): Promise<boolean> {
    const thread = await readThread(job.ticketId);
    const last = thread?.messages[thread.messages.length - 1];
    // Nothing to answer: gone, finished, stopped, or the member is not the
    // one waiting.
    if (!thread || !thread.isOpen || thread.assistantPaused || !last || last.author !== "member") return drop(job);
    const mode = modeFor(config, thread.departmentId);
    if (mode === "off") return drop(job);

    let draft = await prisma.aiSupportDraft.findFirst({
        where: { ticketId: thread.id, afterMessageId: last.id },
        select: { id: true, status: true, reply: true, canAnswer: true, confidence: true },
    });
    let asked = false;
    if (!draft) {
        asked = true;
        const made = await draftFor(job, thread, last.id, config, now);
        if (!made) return asked;
        draft = made;
    }
    if (mode !== "auto" || draft.status !== "draft") return (await drop(job)) || asked;

    const sure = draft.canAnswer && (draft.confidence ?? 0) >= config.threshold;
    const sent = await prisma.aiSupportDraft.count({ where: { ticketId: thread.id, status: "sent" } });
    const timeZone = await siteTimeZone();
    if (!sure || sent >= config.maxAuto || !inWindow(now, timeZone, config.days, config.from, config.to)) return (await drop(job)) || asked;

    // Staff answer first. Until the wait is over the draft waits with the job.
    const answerableAt = new Date(last.createdAt.getTime() + config.waitMinutes * MINUTE);
    if (now < answerableAt) {
        await reschedule(job, { dueAt: answerableAt });
        return asked;
    }

    const outcome = await postReply({ ticketId: thread.id, content: draft.reply, afterMessageId: last.id });
    await prisma.aiSupportDraft.update({
        where: { id: draft.id },
        data: { status: outcome.ok ? "sent" : outcome.reason === "stale" ? "stale" : "draft" },
    });
    await drop(job);
    return asked;
}

interface DraftRow {
    id: string;
    status: string;
    reply: string;
    canAnswer: boolean;
    confidence: number | null;
}

/**
 * Ask the model about one ticket and keep its answer, or count a failed
 * attempt. Null when there is no draft yet: the job waits for its next try,
 * or has run out of them.
 */
async function draftFor(job: Job, thread: DeskThread, afterMessageId: string, config: AiSupportConfig, now: Date): Promise<DraftRow | null> {
    const site = await siteLanguage();
    const language = config.replyLanguage === "member" && thread.memberLocale ? thread.memberLocale : site;
    const [deskDepartments, deskPriorities] = await Promise.all([departments(language), priorities(language)]);
    const last = thread.messages[thread.messages.length - 1];
    const pieces = config.perSource > 0
        ? await knowledge({
            terms: termsOf(thread.subject, last?.content ?? ""),
            locale: language,
            limit: config.perSource,
            // Every source there is, until the operator picks some.
            sources: config.sources ?? (await knowledgeSources(language)).map((source) => source.id),
        })
        : [];
    const instructions = config.instructions || (await moduleTranslator("aiSupport", language))("defaultInstructions");

    let answer: ModelAnswer;
    try {
        answer = await generateStructured({
            module: "ai-support",
            purpose: PURPOSE,
            tier: "smart",
            ...(config.model ? { model: config.model } : {}),
            system: systemText({ instructions, config, language, departments: deskDepartments, priorities: deskPriorities }),
            input: { trusted: trustedInput(thread), untrusted: untrustedInput(thread, pieces) },
            schema: answerSchema,
            maxOutputTokens: outputTokens(config.maxLength),
        });
    } catch (err) {
        const kind = err instanceof AiError ? err.kind : "provider_error";
        const attempts = job.attempts + 1;
        if (attempts >= config.maxAttempts) {
            await prisma.aiSupportDraft.create({
                data: { ticketId: thread.id, userId: thread.userId, afterMessageId, status: "failed", reply: "", canAnswer: false, error: kind, model: config.model || null },
            });
            await drop(job);
            return null;
        }
        await reschedule(job, { attempts, dueAt: new Date(now.getTime() + attempts * RETRY_STEP) });
        return null;
    }

    // A suggestion counts only when it names something the desk has and the
    // operator asked for it; the desk checks again before it moves anything.
    const departmentId = config.classifyDepartment !== "off" && answer.departmentId && answer.departmentId !== thread.departmentId && deskDepartments.some((d) => d.id === answer.departmentId)
        ? answer.departmentId
        : null;
    const priority = config.classifyPriority !== "off" && answer.priorityId && answer.priorityId !== thread.priority && deskPriorities.some((p) => p.id === answer.priorityId)
        ? answer.priorityId
        : null;
    const apply = {
        ...(departmentId && config.classifyDepartment === "apply" ? { departmentId } : {}),
        ...(priority && config.classifyPriority === "apply" ? { priority } : {}),
    };
    if (Object.keys(apply).length > 0) await classify({ ticketId: thread.id, ...apply });

    const used = pieces
        .map((piece, i) => ({ piece, label: sourceLabel(i) }))
        .filter(({ label }) => answer.sources.includes(label))
        .map(({ piece }) => ({ source: piece.source, title: piece.title, ...(piece.href ? { href: piece.href } : {}) }));

    return prisma.aiSupportDraft.create({
        data: {
            ticketId: thread.id,
            userId: thread.userId,
            afterMessageId,
            status: "draft",
            reply: answer.reply.trim().slice(0, config.maxLength),
            canAnswer: answer.canAnswer && answer.reply.trim().length > 0,
            confidence: answer.confidence,
            sources: used,
            departmentId,
            priority,
            model: config.model || null,
        },
        select: { id: true, status: true, reply: true, canAnswer: true, confidence: true },
    });
}
