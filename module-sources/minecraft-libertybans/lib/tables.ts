/**
 * Where LibertyBans keeps a punishment, and what its numbers mean.
 *
 * LibertyBans is not laid out like LiteBans, and the differences decide how
 * this module reads it:
 *
 * - Every punishment is one row in `punishments`, numbered from one sequence,
 *   whatever its kind. The kind is a column, `type`, holding the ordinal of its
 *   `PunishmentType` enum. So one cursor covers all four kinds.
 * - `history` lists every punishment ever handed down, kicks included. The
 *   `simple_history` view joins it to the punishment and to who it is against,
 *   and is the view the plugin's own `/history` reads. That view is what this
 *   module reads.
 * - `bans`, `mutes` and `warns` list the punishments still in force. Nothing in
 *   a row says a punishment was lifted: the plugin deletes it from its kind's
 *   table instead, and it deletes an expired one from there too. A kick is
 *   never in any of them.
 *
 * LibertyBans always names its tables `libertybans_...` (`DatabaseConstants`),
 * but a database the site is given may hold copies under another name, so the
 * prefix is still an operator's. It is validated as an identifier before it
 * reaches a query; see `query.ts`.
 */

/** What this site calls each of the four, before a duration is considered. */
export type PunishmentKind = "ban" | "mute" | "warning" | "kick";

/**
 * `PunishmentType` in LibertyBans' API is BAN, MUTE, WARN, KICK, stored as its
 * ordinal (`OrdinalEnumConverter`), and its schema checks `type` is 0 to 3.
 */
export const KIND_BY_TYPE: Readonly<Record<number, PunishmentKind>> = {
    0: "ban",
    1: "mute",
    2: "warning",
    3: "kick",
};

/** The types that sit in a table of their own while they are in force. Not a kick. */
export const STANDING_TYPES = [0, 1, 2] as const;

/** `VictimType`: PLAYER, ADDRESS, COMPOSITE. An address alone names nobody. */
export const ADDRESS_VICTIM = 1;

/** Read for every punishment there has been. */
export const HISTORY_SUFFIX = "simple_history";

/** Each holds the ids of one kind's punishments still in force. */
export const STANDING_SUFFIXES = ["bans", "mutes", "warns"] as const;

/** Every name each UUID has joined under, with when it was last seen. */
export const NAMES_SUFFIX = "names";

/** The prefix a LibertyBans install has unless its operator changed it. */
export const DEFAULT_PREFIX = "libertybans_";
