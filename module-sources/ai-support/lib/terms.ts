/**
 * The words a ticket is looked up by in the knowledge sources.
 *
 * The site's search matches every word it is given, so a member's paragraph
 * matches nothing. A source is handed these instead and matches any of them:
 * the longer words of the subject and the last message, once each, longest
 * first, since a long word says more about a ticket than a short one.
 */

const MIN_LENGTH = 4;
const MAX_TERMS = 10;

export function termsOf(...texts: string[]): string[] {
    const words = texts
        .join(" ")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => [...word].length >= MIN_LENGTH);
    return [...new Set(words)]
        .sort((a, b) => [...b].length - [...a].length)
        .slice(0, MAX_TERMS);
}
