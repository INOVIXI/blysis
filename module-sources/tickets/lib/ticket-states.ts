import type { BadgeTone } from "@/core/sdk/ui";

/**
 * What state a ticket can be in, and what a state means.
 *
 * Five statuses and four priorities were Prisma enums. Good words, and not
 * every support desk's words: a site that triages into "First line" and "With
 * the developers" could not say so, one that never resolves anything could
 * not take `RESOLVED` away, and neither list could grow - an enum is a
 * database type, so adding a value to it is a migration rather than a
 * setting.
 *
 * They are rows. The ones this module ships are seeded and carry a `nameKey`,
 * so they stay translated in both languages; a state an operator adds carries
 * the word they typed, which is the only form anybody will ever see it in.
 * That is the same split `PunishmentScope` makes between a name a reader
 * reads and a key nothing draws.
 */

/** The tones a state may be drawn in. A state outside this list is neutral. */
export const STATE_TONES = ["neutral", "success", "warning", "danger", "info"] as const;

export interface TicketState {
    key: string;
    name: string | null;
    nameKey: string | null;
    tone: string;
    /** Whether a ticket in this state is still being worked on. */
    isOpen?: boolean;
    /** Whether moving a ticket here stamps the day it was finished. */
    closesTicket?: boolean;
}

/**
 * The five this module ships.
 *
 * `isOpen` and `closesTicket` are the two facts three files used to state as
 * `status === "CLOSED" || status === "RESOLVED"` - a rule that cannot survive
 * an operator renaming anything, and one nobody could have extended.
 */
export const DEFAULT_STATUSES = [
    // The keys are this module's public ones. Core strips `adm_` keys from
    // the catalogue a public page receives, so a state named under one would
    // have no word on the public ticket list - and these nine are the same
    // nine words either side.
    { key: "OPEN", nameKey: "open", tone: "info", order: 10, isOpen: true, closesTicket: false },
    { key: "IN_PROGRESS", nameKey: "inProgress", tone: "warning", order: 20, isOpen: true, closesTicket: false },
    { key: "WAITING_REPLY", nameKey: "waitingReply", tone: "warning", order: 30, isOpen: true, closesTicket: false },
    { key: "RESOLVED", nameKey: "resolved", tone: "success", order: 40, isOpen: false, closesTicket: true },
    { key: "CLOSED", nameKey: "closed", tone: "neutral", order: 50, isOpen: false, closesTicket: true },
] as const;

/** The four this module ships. */
export const DEFAULT_PRIORITIES = [
    { key: "LOW", nameKey: "low", tone: "neutral", order: 10 },
    { key: "MEDIUM", nameKey: "medium", tone: "info", order: 20 },
    { key: "HIGH", nameKey: "high", tone: "warning", order: 30 },
    { key: "URGENT", nameKey: "urgent", tone: "danger", order: 40 },
] as const;

/**
 * The three states the flow itself names, as opposed to the ones a screen
 * merely draws.
 *
 * A ticket opens in one, a member's reply returns it to it, and a staff reply
 * moves it to the one that means "we are waiting on you". Every other rule is
 * a flag on the row, because it is a fact about the state; these three are
 * facts about the flow, and a flag for each would be three more questions an
 * operator has to answer to add a status.
 *
 * An operator may take any of them away, and then the flow leaves the status
 * alone rather than writing a key nothing names - see `movedTo`.
 */
export const FIRST_STATUS = "OPEN";
export const AWAITING_MEMBER_STATUS = "WAITING_REPLY";
export const DEFAULT_PRIORITY = "MEDIUM";

/**
 * Where a reply moves a ticket, or null to leave it where it is.
 *
 * A reply to a finished ticket leaves it finished - a reply to a resolved
 * ticket used to reopen it, which surprised operators. Otherwise it moves to
 * the state the flow names, unless the desk has taken that state away.
 */
export function movedTo(
    current: string,
    byStaff: boolean,
    states: readonly TicketState[],
): string | null {
    const now = states.find((state) => state.key === current);
    if (now && now.isOpen === false) return null;
    const wanted = byStaff ? AWAITING_MEMBER_STATUS : FIRST_STATUS;
    return states.some((state) => state.key === wanted) ? wanted : null;
}

type Translator = ((key: string) => string) & { has: (key: string) => boolean };

/**
 * What a state is called: the module's own word where it has one, the
 * operator's where they typed one, and the key itself made readable where a
 * ticket holds a state that has since been taken away.
 */
export function stateLabel(t: Translator, key: string, states: readonly TicketState[] = []): string {
    const state = states.find((one) => one.key === key);
    if (state?.nameKey && t.has(state.nameKey)) return t(state.nameKey);
    if (state?.name) return state.name;
    return key.replace(/_/g, " ");
}

/** Neutral for a state no row names: an unknown state is not an alarming one. */
export function stateTone(key: string, states: readonly TicketState[] = []): BadgeTone {
    const tone = states.find((one) => one.key === key)?.tone;
    return (STATE_TONES as readonly string[]).includes(tone ?? "")
        ? (tone as BadgeTone)
        : "neutral";
}

/**
 * Whether a ticket in this state is still being worked on.
 *
 * Unknown counts as open: a ticket holding a state an operator has retired
 * is not finished, and a screen that treats it as finished hides the reply
 * box on a conversation nobody ended.
 */
export function isOpenState(key: string, states: readonly TicketState[]): boolean {
    const state = states.find((one) => one.key === key);
    return state ? state.isOpen !== false : true;
}

/** The statuses that mean a ticket is still being worked on. */
export function openStatusKeys(states: readonly TicketState[]): string[] {
    return states.filter((state) => state.isOpen).map((state) => state.key);
}

/** Whether moving a ticket into this status stamps the day it was finished. */
export function closesTicket(key: string, states: readonly TicketState[]): boolean {
    return states.find((state) => state.key === key)?.closesTicket === true;
}

/** A nextKindOrder for states: a new one goes after the ones already there. */
export function nextStateOrder(highest: number | null): number {
    return (highest ?? 0) + 10;
}
