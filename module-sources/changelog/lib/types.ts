/**
 * What a release note can be, in one place.
 *
 * The type reached the row as free text - the admin form was an input with
 * "update, feature, fix, breaking" in its placeholder - and the badge beside
 * it was coloured from a separate `color` field whose default was the same
 * blue for every entry. So a page of releases showed the same blue chip
 * against every one of them, with whatever English word the operator happened
 * to type inside it, on a Turkish page.
 *
 * The type is the meaning, so the colour comes from it rather than from a
 * second field somebody has to remember to change, and the word is a
 * translation key rather than whatever was typed.
 */

/**
 * The six this module ships, seeded once into `ChangelogType`.
 *
 * They are the module's own words, so they carry a `nameKey` and stay
 * translated. A kind an operator adds carries the word they typed instead,
 * which is the only form anybody will ever see it in - the same split
 * `PunishmentScope` makes between a name a reader reads and a key nothing
 * draws.
 *
 * Seeded rather than enforced: an operator may rename one, re-tone it, or
 * take it away, which is what this whole change is for.
 */
export const DEFAULT_TYPES = [
    { key: "feature", nameKey: "type_feature", tone: "success", order: 10 },
    { key: "improvement", nameKey: "type_improvement", tone: "info", order: 20 },
    { key: "fix", nameKey: "type_fix", tone: "neutral", order: 30 },
    { key: "security", nameKey: "type_security", tone: "warning", order: 40 },
    { key: "removed", nameKey: "type_removed", tone: "neutral", order: 50 },
    { key: "breaking", nameKey: "type_breaking", tone: "danger", order: 60 },
] as const;

export type ChangelogType = (typeof DEFAULT_TYPES)[number]["key"];

/** The tones a kind may be drawn in. A kind outside this list is neutral. */
export const CHANGELOG_TONES = ["neutral", "success", "warning", "danger", "info"] as const;

export type ChangelogTone = (typeof CHANGELOG_TONES)[number];

/** One kind, as the screens receive it. */
export interface ChangelogKind {
    key: string;
    name: string | null;
    nameKey: string | null;
    tone: string;
}

export function changelogTone(type: string, kinds: readonly ChangelogKind[] = []): ChangelogTone {
    const tone = kinds.find((kind) => kind.key === type)?.tone;
    return CHANGELOG_TONES.includes(tone as ChangelogTone) ? (tone as ChangelogTone) : "neutral";
}

/**
 * What a kind is called: the module's own word where it has one, the
 * operator's where they typed one, and the key itself where a release was
 * written under a kind that has since been removed.
 */
export function changelogKindLabel(
    t: { (key: string): string; has(key: string): boolean },
    type: string,
    kinds: readonly ChangelogKind[] = [],
): string {
    const kind = kinds.find((k) => k.key === type);
    if (kind?.nameKey && t.has(kind.nameKey)) return t(kind.nameKey);
    if (kind?.name) return kind.name;
    return changelogTypeLabel(t, type);
}

/**
 * The word for a type. A row written before this vocabulary existed may hold
 * anything at all, so an unknown type is printed as it stands rather than
 * folded into the first word in the list - which is how a "breaking" release
 * would come to be labelled "feature".
 */
export function changelogTypeLabel(t: { (key: string): string; has(key: string): boolean }, type: string): string {
    const key = `type_${type}`;
    return t.has(key) ? t(key) : type;
}

/**
 * Where a kind an operator adds belongs: after the ones already there.
 *
 * The column defaults to 0 and the six this module seeds sit at 10 to 60, so
 * a row created with nothing said about its order came out above all of them.
 * Somebody adding "Known issue" got it at the top of their own manager and
 * first in the dropdown that writes a release, ahead of "Feature".
 *
 * It takes the highest order there is rather than the rows themselves,
 * because the caller can ask the database that question with one row instead
 * of the table.
 *
 * A step of ten, the way the seeded ones are spaced, so a later hand-edit has
 * room between two rows.
 */
export function nextKindOrder(highest: number | null): number {
    return (highest ?? 0) + 10;
}
