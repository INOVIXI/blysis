/**
 * Hostname allowlist matching that is NOT vulnerable to the classic
 * `hostname.endsWith("discord.com")` suffix bypass - that check also accepts
 * "evildiscord.com" and "discord.com.attacker.test". A hostname matches only
 * when it equals an allowed domain exactly or is a true subdomain of it.
 */
export function hostnameMatchesAllowlist(hostname: string, domains: string[]): boolean {
    const h = hostname.toLowerCase().replace(/\.$/, "");
    return domains.some((d) => {
        const dom = d.toLowerCase();
        return h === dom || h.endsWith("." + dom);
    });
}

/** Names that only resolve inside the network they are asked from. */
const PRIVATE_HOST_SUFFIXES = [".local", ".internal", ".localdomain", ".home.arpa"];

function isPrivateIpv4(host: string): boolean {
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!v4) return false;
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

/**
 * The IPv4 inside an IPv4-mapped IPv6 literal, or null.
 *
 * `https://[::ffff:127.0.0.1]/` reaches the loopback exactly as
 * `https://127.0.0.1/` does, and the URL parser hands it back in its
 * normalized hex form, `::ffff:7f00:1`, which matches none of the IPv6
 * prefixes below. Both spellings are unpacked here and then checked against
 * the IPv4 rules.
 */
function mappedIpv4(v6: string): string | null {
    if (!v6.startsWith("::ffff:")) return null;
    const rest = v6.slice("::ffff:".length);

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return rest;

    const groups = rest.split(":");
    if (groups.length !== 2) return null;
    const [hi, lo] = groups.map((g) => Number.parseInt(g, 16));
    if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
    if (hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return null;
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

/**
 * A host that only exists inside the operator's own network: loopback, a
 * private or link-local range, a local-only name, or a single-label name.
 *
 * Written for what `URL.hostname` hands back, so an IPv6 literal is expected
 * in brackets. Two callers ask it for opposite reasons: a webhook must not be
 * pointed inside the network (core fetches it server side), and a game
 * server's address must not be told to the world when it is an inside one.
 */
export function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, "");

    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
    // A single-label name only resolves inside the local network.
    if (!host.includes(".") && !host.includes(":")) return true;

    // IPv6 literals arrive from URL.hostname wrapped in brackets.
    const v6 = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : null;
    if (v6) {
        const mapped = mappedIpv4(v6);
        if (mapped) return isPrivateIpv4(mapped);
        return v6 === "::1" || v6 === "::" || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe80:/.test(v6);
    }

    return isPrivateIpv4(host);
}
