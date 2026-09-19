/**
 * What an activity event is called, and how its stored title is localized.
 *
 * Activity titles are written to the DB as English-formatted strings
 * like "Replied to: How to start" or "Suggested: Dark mode". To keep
 * older entries readable on non-English locales without a schema
 * change, we pattern-match the known prefixes (which line up with the
 * `type` field) and replace just the prefix with a translated version,
 * keeping the entity name (the dynamic part) intact.
 *
 * The prefix→key map is registry-driven: modules declare their activity
 * event types via the `activityTitles` manifest field, aggregated at build
 * time into `ModuleActivityTitles`. Core knows only its own events.
 *
 * Pass `t` from `useTranslations("activity")` (client) or
 * `getTranslations("activity")` (server). Falls back to the raw title
 * for any type/prefix combination we don't recognize.
 */
import { ModuleActivityTitles } from "@/core/generated/module-registry";

type Translator = ((key: string) => string) & { has?: (key: string) => boolean };

// Core-only activity events. Module events are merged in from the registry.
// An empty prefix means the stored title is a whole English sentence with no
// entity in it, so the translation replaces all of it.
const CORE_PREFIXES: Record<string, { prefix: string; key: string }> = {
    "user.registered": { prefix: "", key: "userRegistered" },
    "user.2fa.enabled": { prefix: "", key: "twoFactorEnabled" },
    "user.2fa.disabled": { prefix: "", key: "twoFactorDisabled" },
};

const PREFIXES: Record<string, { prefix: string; key: string }> = {
    ...CORE_PREFIXES,
    ...Object.fromEntries(
        ModuleActivityTitles
            .filter((e) => e.prefix !== undefined && e.key !== undefined)
            .map((e) => [e.type, { prefix: e.prefix as string, key: e.key as string }]),
    ),
};

/**
 * What each kind of event is called, on its own.
 *
 * Separate from the title substitution above because the two answer different
 * questions and not every event can answer both. Six events put the entity in
 * the middle of their English - "Received 40 credits" - so no prefix
 * describes them, and for months that meant the filter above a member's own
 * activity offered them as `vote.vote.cast`. A name is a string of its own,
 * every event has one, and `a-machine-name-is-not-a-label` holds every event
 * to it.
 */
const CORE_NAMES: Record<string, string> = {
    "user.registered": "kindUserRegistered",
    "user.profile.updated": "kindUserProfileUpdated",
    "user.2fa.enabled": "kindTwoFactorEnabled",
    "user.2fa.disabled": "kindTwoFactorDisabled",
};

const NAMES: Record<string, string> = {
    ...CORE_NAMES,
    ...Object.fromEntries(ModuleActivityTitles.map((e) => [e.type, e.nameKey])),
};

/**
 * Every kind of activity anything on this site writes, with the key that
 * names it.
 *
 * Built from the same map the label lookup uses, so a screen offering these
 * to an operator and a screen printing one back cannot disagree about what
 * exists. The trophies module needed it: its rule was a free text box where
 * somebody had to know that `forum.topic.created` is a string, spell it, and
 * know it is the one the engine counts - and a misspelling made a trophy
 * nobody could ever be given, with nothing to say so.
 *
 * Sorted by the key rather than the type, so the list reads in the order the
 * words do once they are translated, not in the order the modules loaded.
 */
export function activityKinds(): { type: string; nameKey: string }[] {
    return Object.entries(NAMES)
        .map(([type, nameKey]) => ({ type, nameKey }))
        .sort((a, b) => a.nameKey.localeCompare(b.nameKey));
}

export function localizeActivityTitle(type: string, title: string, t: Translator): string {
    const cfg = PREFIXES[type];
    if (!cfg) return title;
    // For prefixed entries, strip the English prefix and substitute.
    if (cfg.prefix) {
        // A declared prefix that does not match is a declaration about a title
        // this row does not have, so nothing here knows where the entity ends.
        // Substituting the label anyway threw the entity away: the store
        // declared "Purchased: " for rows written as "Completed order #1412",
        // and every one of them rendered as a bare "purchased:" with the order
        // number gone. The raw title is at least the whole sentence.
        if (!title.startsWith(cfg.prefix)) return title;
        const entity = title.slice(cfg.prefix.length);
        return t.has?.(cfg.key) === false ? title : `${t(cfg.key)} ${entity}`.trim();
    }
    // For prefix-free entries (e.g. user.registered), title is the whole
    // English sentence - return our translation as-is.
    return t.has?.(cfg.key) === false ? title : t(cfg.key);
}

/**
 * What a kind of activity is called, for a control that lists the kinds.
 *
 * It used to read the title substitution instead, which gave "Purchased:" -
 * a sentence fragment with a colon on it - for the events that had one, and
 * the raw `type` for the six that did not. A kind has a name of its own now.
 *
 * The fallback is still the type, because a row written by a module that has
 * since been uninstalled has nothing else to be called. Nothing installed can
 * reach it: the gate refuses a manifest that emits an event it has not named.
 */
export function activityTypeLabel(type: string, t: Translator): string {
    const nameKey = NAMES[type];
    if (!nameKey) return type;
    return t.has?.(nameKey) === false ? type : t(nameKey);
}
