/**
 * An address an operator typed into a setting, if it is one a link may carry.
 *
 * A path on this site or an http(s) address, and nothing else: a setting is
 * free text, and `javascript:` in an href runs on every visitor who presses
 * the button. A host typed without its scheme is the web address it names
 * (`webAddress`). Anything that is not plainly one of these is no link.
 */
export function linkTarget(raw: unknown): { href: string; external: boolean } | null {
    if (typeof raw !== "string") return null;
    const value = webAddress(raw);
    if (/^\/(?![/\\])/.test(value)) return { href: value, external: false };
    if (/^https?:\/\/[^\s/]+/i.test(value)) return { href: value, external: true };
    return null;
}

/**
 * A web address typed the way people type one, with its scheme.
 *
 * "facebook.com/acme" is what an operator writes into a social field, and as
 * an href it is a path on this site. A value that starts like a host name is
 * given `https://`; a path, a value that already names a scheme, and anything
 * else is left as it is, for `linkTarget` to accept or refuse.
 */
export function webAddress(raw: string): string {
    const value = raw.trim();
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#:]|$)/i.test(value)) return `https://${value}`;
    return value;
}
