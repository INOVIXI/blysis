/**
 * An address an operator typed into a setting, if it is one a link may carry.
 *
 * A path on this site or an http(s) address, and nothing else: a setting is
 * free text, and `javascript:` in an href runs on every visitor who presses
 * the button. Anything that is not plainly one of the two is no link at all.
 */
export function linkTarget(raw: unknown): { href: string; external: boolean } | null {
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (/^\/(?![/\\])/.test(value)) return { href: value, external: false };
    if (/^https?:\/\/[^\s/]+/i.test(value)) return { href: value, external: true };
    return null;
}
