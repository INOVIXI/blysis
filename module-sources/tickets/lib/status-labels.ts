/**
 * The label for a ticket's status or priority, in the reader's language.
 *
 * Both are Prisma enums, so what the database holds is `IN_PROGRESS` and
 * `URGENT`. The ticket list on the public side worked this out and mapped
 * them to message keys; the ticket detail page beside it, and both admin
 * screens, printed the enum instead - a Turkish visitor read "WAITING_REPLY"
 * where a status belonged, and the same page said "Oncelik: HIGH". The maps
 * live here so the four screens cannot drift apart again.
 *
 * The `t.has` guard is deliberate: next-intl renders the key path rather than
 * throwing when a message is missing, so an unmapped value falls back to
 * something readable instead of to "tickets.inProgress".
 */

/** Message key per TicketStatus, for the public catalogue. */
export const STATUS_KEYS: Record<string, string> = {
    OPEN: "open",
    IN_PROGRESS: "inProgress",
    WAITING_REPLY: "waitingReply",
    RESOLVED: "resolved",
    CLOSED: "closed",
};

/**
 * The same statuses under the admin catalogue, whose keys are the public ones
 * behind an `adm_` prefix.
 *
 * Built by the admin screens rather than named here: core strips `adm_` keys
 * from the catalogue a public page receives, so a shared file must not carry
 * one - `validate-module` fails a module for exactly that.
 */
export function adminKeys(keys: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(keys).map(([value, key]) => [value, `adm_${key}`]));
}

/** Message key per TicketPriority. The admin catalogue reuses these. */
export const PRIORITY_KEYS: Record<string, string> = {
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    URGENT: "urgent",
};

type Translator = ((key: string) => string) & { has: (key: string) => boolean };

/** Look one up, falling back to a readable form of the enum itself. */
export function labelFor(t: Translator, keys: Record<string, string>, value: string): string {
    const key = keys[value];
    return key && t.has(key) ? t(key) : value.replace(/_/g, " ");
}

/**
 * The colour a status or a priority wears.
 *
 * Four screens each kept a map of their own - the public list, the public
 * ticket, the admin list and the admin ticket - and no two agreed. A ticket
 * waiting for a reply was accent-tinted on one screen and amber on another,
 * and each map wrote its own `bg-.../10 text-...` pair rather than using the
 * badge every other status on the site is drawn with. They are tones now, and
 * the badge decides what a tone looks like.
 */
import type { BadgeTone } from "@/core/sdk/ui";

const STATUS_TONES: Record<string, BadgeTone> = {
    OPEN: "info",
    IN_PROGRESS: "warning",
    WAITING_REPLY: "warning",
    RESOLVED: "success",
    CLOSED: "neutral",
};

const PRIORITY_TONES: Record<string, BadgeTone> = {
    LOW: "neutral",
    MEDIUM: "info",
    HIGH: "warning",
    URGENT: "danger",
};

/** Neutral for a value no map names: an unknown state is not an alarming one. */
export function statusTone(status: string): BadgeTone {
    return STATUS_TONES[status] ?? "neutral";
}

export function priorityTone(priority: string): BadgeTone {
    return PRIORITY_TONES[priority] ?? "neutral";
}
