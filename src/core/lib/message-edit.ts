import { fillPlaceholderText, placeholderTokens } from "@/core/lib/placeholder-text";

/**
 * Judging an operator's edit to a message before it is stored.
 *
 * The translation editor hands an operator every string the site renders, and
 * some of those carry values the calling code passes in: "{count} orders",
 * "{count, plural, one {# reply} other {# replies}}". The caller passes the
 * values the shipped string names and no others, so a string that names one
 * more stops formatting - next-intl catches the error and renders the key, and
 * the reader sees `store.adm_ordersTotal` where a sentence belongs. A brace
 * left open does the same, one step earlier, at parse time.
 *
 * Dropping a value is the operator's business: a translation may not need the
 * number. Inventing one is not, because nothing will ever supply it. Hence a
 * one-directional rule, measured against what this version ships rather than
 * against the row in the table, which may itself already be an edit.
 *
 * The reading is structural because it has to be. A plural's options are
 * messages in their own right, so in `{count, plural, other {orders}}` the
 * word `orders` sits inside braces and is not a value, while `count` is one.
 * Scanning for braces cannot tell those apart; this walks the grammar the
 * formatter walks.
 */

/** What the `value` column holds comfortably, and longer than any UI string. */
export const MAX_MESSAGE_LENGTH = 5000;

export interface EditRefusal {
    reason: "empty" | "too_long" | "malformed" | "new_placeholder";
    /** For `new_placeholder`, the names the edit introduced. */
    names?: string[];
}

export interface MessageReading {
    /** Every value the message asks for, sorted, without repeats. */
    names: string[];
    /** False when a formatter would reject the message outright. */
    wellFormed: boolean;
}

/** ICU accepts a numeric argument as readily as a named one. */
const ARGUMENT_NAME = /^[A-Za-z0-9_]+$/;

export function readPlaceholders(message: string): MessageReading {
    const names = new Set<string>();
    let wellFormed = true;
    let at = 0;

    const done = () => at >= message.length;

    /**
     * ICU quoting: `''` is one apostrophe, and an apostrophe before a brace or
     * a `#` opens a literal run that the next lone apostrophe closes.
     */
    function skipQuoted(): void {
        const next = message[at + 1];
        if (next === "'") {
            at += 2;
            return;
        }
        if (next !== "{" && next !== "}" && next !== "#") {
            at += 1;
            return;
        }
        at += 2;
        while (!done()) {
            if (message[at] === "'") {
                if (message[at + 1] === "'") {
                    at += 2;
                    continue;
                }
                at += 1;
                return;
            }
            at += 1;
        }
    }

    function skipSpace(): void {
        while (!done() && /\s/.test(message[at])) at += 1;
    }

    /** Reads up to the next comma or closing brace, whichever comes first. */
    function readWord(): string {
        const from = at;
        while (!done() && message[at] !== "," && message[at] !== "}") at += 1;
        return message.slice(from, at).trim();
    }

    /**
     * A format style is opaque to us - a date skeleton, a number pattern, a
     * shape a plugin understands - so it is stepped over rather than read,
     * counting braces so the argument's own closing one is found.
     */
    function skipStyle(): void {
        let depth = 1;
        while (!done()) {
            const char = message[at];
            if (char === "'") {
                skipQuoted();
                continue;
            }
            if (char === "{") depth += 1;
            if (char === "}") {
                depth -= 1;
                if (depth === 0) {
                    at += 1;
                    return;
                }
            }
            at += 1;
        }
        wellFormed = false;
    }

    /** `one {...} other {...}`, up to the brace that closes the argument. */
    function parseOptions(): void {
        while (true) {
            skipSpace();
            if (done()) break;
            if (message[at] === "}") {
                at += 1;
                return;
            }
            while (!done() && message[at] !== "{" && message[at] !== "}" && !/\s/.test(message[at])) at += 1;
            skipSpace();
            if (done() || message[at] !== "{") break;
            at += 1;
            parseMessage(true);
            if (done() || message[at] !== "}") break;
            at += 1;
        }
        wellFormed = false;
    }

    /** Called with `at` just past the opening brace. */
    function parseArgument(): void {
        skipSpace();
        const name = readWord();
        if (done()) {
            wellFormed = false;
            return;
        }
        if (ARGUMENT_NAME.test(name)) names.add(name);
        else wellFormed = false;
        if (message[at] === "}") {
            at += 1;
            return;
        }
        at += 1;
        skipSpace();
        const type = readWord();
        if (done()) {
            wellFormed = false;
            return;
        }
        if (message[at] === "}") {
            at += 1;
            return;
        }
        at += 1;
        if (type === "plural" || type === "select" || type === "selectordinal") parseOptions();
        else skipStyle();
    }

    /**
     * `inOption` is true for the body of a plural or select option, which ends
     * at a closing brace its caller consumes rather than at the end of input.
     */
    function parseMessage(inOption: boolean): void {
        while (!done()) {
            const char = message[at];
            if (char === "'") {
                skipQuoted();
                continue;
            }
            if (char === "}") {
                if (inOption) return;
                wellFormed = false;
                at += 1;
                continue;
            }
            if (char === "{") {
                at += 1;
                parseArgument();
                continue;
            }
            at += 1;
        }
        if (inOption) wellFormed = false;
    }

    parseMessage(false);
    return { names: [...names].sort(), wellFormed };
}

/**
 * A site placeholder, `{servers.online}`, reads to the formatter as a blank
 * with a name it does not accept. The catalogue fills each one before the
 * formatter sees it (`withLiveValues`), so it is set aside here as the
 * plain text it becomes.
 */
function withoutSitePlaceholders(message: string): string {
    return fillPlaceholderText(message, {}, String, () => "x");
}

/**
 * Null when the edit may be stored, a refusal naming the problem when not.
 * The caller stores the trimmed string; the surrounding whitespace is ignored
 * here for the same reason. `sitePlaceholders` are the site placeholders
 * this install answers: an edit may name any of them, and one the shipped
 * string already named, but no other, since a typo would show its fallback
 * to every visitor and nobody would be told.
 */
export function checkMessageEdit(
    shipped: string,
    typed: string,
    sitePlaceholders: ReadonlySet<string> = new Set(),
): EditRefusal | null {
    const text = typed.trim();
    if (text === "") return { reason: "empty" };
    if (text.length > MAX_MESSAGE_LENGTH) return { reason: "too_long" };

    const shippedTokens = new Set(placeholderTokens(shipped).map((token) => token.name));
    const unanswered = [...new Set(placeholderTokens(text).map((token) => token.name))]
        .filter((name) => !sitePlaceholders.has(name) && !shippedTokens.has(name));

    const after = readPlaceholders(withoutSitePlaceholders(text));
    if (!after.wellFormed) return { reason: "malformed" };
    if (unanswered.length > 0) return { reason: "new_placeholder", names: unanswered.sort() };

    const before = readPlaceholders(withoutSitePlaceholders(shipped));
    // A shipped string a formatter would reject cannot say what an edit is
    // allowed to name, and refusing on its account would make the one screen
    // that can repair it the one screen that will not.
    if (!before.wellFormed) return null;

    const invented = after.names.filter((name) => !before.names.includes(name));
    if (invented.length > 0) return { reason: "new_placeholder", names: invented };
    return null;
}
