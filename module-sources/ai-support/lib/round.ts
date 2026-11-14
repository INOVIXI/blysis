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

export async function runAnswerRound(now = new Date()): Promise<{ handled: number }> {
    // One round at a time in a process: a slow model must not let the next
    // minute's round answer the same ticket again.
    if (running) return { handled: 0 };
    running = true;
    try {
        const config = await readConfig();
        const jobs = await prisma.aiSupportJob.findMany({
            where: { dueAt: { lte: now } },
            orderBy: { dueAt: "asc" },
            take: config.perRun,
            select: { id: true, ticketId: true, attempts: true },
        });
        for (const job of jobs) {
            try {
                await answer(job, config, now);
            } catch (err) {
                // One ticket's failure is not the round's: the next job runs.
                log.error("[ai-support] a ticket could not be answered", { ticketId: job.ticketId, error: err instanceof Error ? err.message : String(err) });
                await prisma.aiSupportJob.deleteMany({ where: { id: job.id } });
            }
        }
        return { handled: jobs.length };
    } finally {
        running = false;
    }
}

interface Job {
    id: string;
    ticketId: string;
    attempts: number;
}

async function drop(job: Job): Promise<void> {
    await prisma.aiSupportJob.deleteMany({ where: { id: job.id } });
}

async function answer(job: Job, config: AiSupportConfig, now: Date): Promise<void> {
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
    if (!draft) {
        const made = await draftFor(job, thread, last.id, config, now);
        if (!made) return;
        draft = made;
    }
    if (mode !== "auto" || draft.status !== "draft") return drop(job);

    const sure = draft.canAnswer && (draft.confidence ?? 0) >= config.threshold;
    const sent = await prisma.aiSupportDraft.count({ where: { ticketId: thread.id, status: "sent" } });
    const timeZone = await siteTimeZone();
    if (!sure || sent >= config.maxAuto || !inWindow(now, timeZone, config.days, config.from, config.to)) return drop(job);

    // Staff answer first. Until the wait is over the draft waits with the job.
    const answerableAt = new Date(last.createdAt.getTime() + config.waitMinutes * MINUTE);
    if (now < answerableAt) {
        await prisma.aiSupportJob.update({ where: { id: job.id }, data: { dueAt: answerableAt } });
        return;
    }

    const outcome = await postReply({ ticketId: thread.id, content: draft.reply, afterMessageId: last.id });
    await prisma.aiSupportDraft.update({
        where: { id: draft.id },
        data: { status: outcome.ok ? "sent" : outcome.reason === "stale" ? "stale" : "draft" },
    });
    await drop(job);
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
        await prisma.aiSupportJob.update({ where: { id: job.id }, data: { attempts, dueAt: new Date(now.getTime() + attempts * RETRY_STEP) } });
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
