/**
 * A UUID as LibertyBans stores it, and as this site writes it.
 *
 * LibertyBans keeps a UUID as `BINARY(16)` on MariaDB and MySQL and as a native
 * `UUID` on PostgreSQL (`Vendor.uuidType()`), so a row hands back a Buffer from
 * one driver and a string from the other. Both are turned into the lowercase,
 * dashed spelling the rest of the site uses, and a lookup by UUID has to bind
 * the bytes on one side and the text on the other.
 *
 * The all-zero UUID is LibertyBans' word for nobody: it is what an address-only
 * victim carries in its UUID column, and it is the console as an operator
 * (`EmptyData.UUID`, `ConsoleOperator`).
 */

import { createHash } from "node:crypto";

export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const HEX32 = /^[0-9a-f]{32}$/;

function dashed(hex: string): string {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The dashed, lowercase spelling, or null when the value is not a UUID. */
export function uuidText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        const bytes = Buffer.from(value);
        return bytes.length === 16 ? dashed(bytes.toString("hex")) : null;
    }
    const hex = String(value).trim().toLowerCase().replace(/-/g, "");
    return HEX32.test(hex) ? dashed(hex) : null;
}

/** The sixteen bytes MariaDB and MySQL compare against. */
export function uuidBytes(text: string): Buffer {
    return Buffer.from(text.replace(/-/g, ""), "hex");
}

/**
 * The UUID a server in offline mode gives a name: Java's
 * `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)`, which is what Paper calls
 * and what LibertyBans' own `OfflineUUID` calls. An MD5 of those bytes with the
 * version set to 3 and the variant to IETF.
 *
 * Case matters: the server derives it from the name exactly as typed at login.
 */
export function offlineUuid(name: string): string {
    const bytes = createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return dashed(bytes.toString("hex"));
}
