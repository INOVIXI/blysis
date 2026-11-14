import { z } from "zod";
import type { UntrustedText } from "@/core/sdk/server";
import type { AiSupportConfig } from "./config";
import type { DeskChoice, DeskThread, KnowledgePiece } from "./desk";

/**
 * What the model is told and handed for one ticket, and the shape it answers in.
 *
 * Only the operator's words are instructions: the default or edited
 * instructions, the tone, the site information and the lists of departments
 * and priorities. The ticket's subject, every message and every knowledge
 * piece go out as untrusted text, labelled by position and kind; core's
 * envelope tells the model that nothing in them is an instruction. A member
 * who writes "refund me" in a ticket is a member asking, not an operator
 * allowing it.
 *
 * The model is given no tools. Its only output is the text below and two
 * suggestions, which the tickets module checks against its own lists.
 */

export const answerSchema = z.object({
    canAnswer: z.boolean(),
    confidence: z.number().int().min(0).max(100),
    reply: z.string().max(16_000),
    sources: z.array(z.string().max(32)).max(20),
    departmentId: z.string().max(64).nullable(),
    priorityId: z.string().max(64).nullable(),
});

export type ModelAnswer = z.infer<typeof answerSchema>;

/** Room for the longest answer the operator allows, and the fields around it. */
export function outputTokens(maxLength: number): number {
    return Math.ceil(maxLength / 3) + 300;
}

const RULES = [
    "Answer only from the site information and the reference material. If they do not hold the answer, set canAnswer to false.",
    "Never promise a refund, credit, item, compensation or anything else the team has not stated in the site information, and never say a ticket is closed or resolved.",
    "Never claim to be a person or a member of staff.",
    "confidence is how sure you are, from 0 to 100, that the reply is correct and complete.",
    "sources lists the labels of the reference pieces the reply relies on.",
];

export function systemText(input: {
    instructions: string;
    config: AiSupportConfig;
    language: string;
    departments: DeskChoice[];
    priorities: DeskChoice[];
}): string {
    const { config } = input;
    const parts = [input.instructions];
    if (config.tone) parts.push(`Tone: ${config.tone}`);
    if (config.siteInfo) parts.push(`Site information, written by the site's team:\n${config.siteInfo}`);
    parts.push(RULES.join("\n"));
    parts.push(`Write the reply in the language whose code is "${input.language}", in at most ${config.maxLength} characters, as Markdown.`);
    parts.push(
        config.classifyDepartment !== "off" && input.departments.length > 0
            ? `departmentId is the department this ticket belongs in, by id, or null if it is already right:\n${input.departments.map((d) => `${d.id}: ${d.label}`).join("\n")}`
            : "departmentId is null.",
    );
    parts.push(
        config.classifyPriority !== "off" && input.priorities.length > 0
            ? `priorityId is how urgent this ticket is, by id, or null if it is already right:\n${input.priorities.map((p) => `${p.id}: ${p.label}`).join("\n")}`
            : "priorityId is null.",
    );
    return parts.join("\n\n");
}

/** The labels a knowledge piece is named by, so an answer's `sources` can be read back. */
export function sourceLabel(index: number): string {
    return `source-${index + 1}`;
}

export function untrustedInput(thread: DeskThread, pieces: KnowledgePiece[]): UntrustedText[] {
    const conversation = thread.messages.map((message, i) => ({ label: `${message.author}-${i + 1}`, text: message.content }));
    const reference = pieces.map((piece, i) => ({ label: sourceLabel(i), text: `${piece.title}\n\n${piece.text}` }));
    return [{ label: "subject", text: thread.subject }, ...conversation, ...reference];
}

export function trustedInput(thread: DeskThread): string {
    return `A support ticket in the department "${thread.departmentName}". The conversation is in order, each message labelled by who wrote it: member, staff or assistant (you, earlier). Reply to the member's last message.`;
}
