/**
 * What this module asks of the support desk and of the knowledge sources,
 * each through a filter another module answers.
 *
 * The shapes are stated here rather than taken from the tickets module's
 * declarations: a site may install this module before the desk, and it still
 * has to build (forum's `leaderboard-board.ts` gives the same reason). With
 * both installed, `npm run typecheck:modules` holds these against the
 * declared contract. With no desk installed every question answers with the
 * value it was asked with, which reads as "no such ticket".
 */
import { applyFiltersAsync } from "@/core/sdk";

export interface DeskMessage {
    id: string;
    author: "member" | "staff" | "assistant";
    content: string;
    createdAt: Date;
}

export interface DeskThread {
    id: string;
    subject: string;
    status: string;
    isOpen: boolean;
    priority: string;
    departmentId: string;
    departmentName: string;
    userId: string | null;
    memberLocale: string | null;
    assistantPaused: boolean;
    messages: DeskMessage[];
}

export interface DeskChoice {
    id: string;
    label: string;
}

export type ReplyOutcome =
    | { ok: true; messageId: string }
    | { ok: false; reason: "not_found" | "closed" | "paused" | "stale" | "empty" };

export interface KnowledgePiece {
    source: string;
    title: string;
    text: string;
    href?: string;
}

export interface KnowledgeQuestion {
    terms: string[];
    locale: string;
    limit: number;
    sources: string[];
}

export interface KnowledgeSource {
    id: string;
    label: string;
}

export function readThread(ticketId: string): Promise<DeskThread | null> {
    return applyFiltersAsync("tickets.thread.read", null as DeskThread | null, { ticketId });
}

export async function postReply(request: { ticketId: string; content: string; afterMessageId: string }): Promise<ReplyOutcome> {
    const outcome = await applyFiltersAsync("tickets.reply.post", null as ReplyOutcome | null, request);
    return outcome ?? { ok: false, reason: "not_found" };
}

export function classify(request: { ticketId: string; departmentId?: string; priority?: string }): Promise<{ changed: ("department" | "priority")[] } | null> {
    return applyFiltersAsync("tickets.ticket.classify", null as { changed: ("department" | "priority")[] } | null, request);
}

export function departments(locale: string): Promise<DeskChoice[]> {
    return applyFiltersAsync("tickets.departments.list", [] as DeskChoice[], { locale });
}

export function priorities(locale: string): Promise<DeskChoice[]> {
    return applyFiltersAsync("tickets.priorities.list", [] as DeskChoice[], { locale });
}

export function knowledge(question: KnowledgeQuestion): Promise<KnowledgePiece[]> {
    return applyFiltersAsync("support.knowledge", [] as KnowledgePiece[], question);
}

export function knowledgeSources(locale: string): Promise<KnowledgeSource[]> {
    return applyFiltersAsync("support.sources", [] as KnowledgeSource[], { locale });
}
