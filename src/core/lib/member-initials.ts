/**
 * The face a member has before they upload one.
 *
 * Most members never upload a picture, and they were all drawn as the same
 * grey silhouette: a list of twenty was twenty identical faces, and the only
 * way to tell who was who was to read the name beside it. Initials on a
 * colour the name itself picks is what every forum worth copying does - the
 * same person is the same colour on every screen, and the letters say who it
 * is at twenty-four pixels, where a silhouette says nothing.
 *
 * Pure, and no imports: a server component renders these into HTML and a
 * client one renders them again, so this cannot reach for a hook or a
 * setting.
 */

/**
 * First letter of each of the first two words, so "Ali Faruk" gives AF and
 * "UXPLIMA" gives U.
 *
 * A username may be anything the site's rules allowed - digits, underscores,
 * an emoji - so the answer is taken from whatever letters or digits are
 * there, and falls back to the first character of the trimmed name. It is
 * never empty: an avatar with nothing in it is a hole in a list.
 */
export function memberInitials(name: string): string {
    const trimmed = (name ?? "").trim();
    if (trimmed === "") return "?";

    const words = trimmed.split(/[\s_.-]+/).filter(Boolean);
    const letters = words
        .slice(0, 2)
        .map((word) => [...word].find((character) => /[\p{L}\p{N}]/u.test(character)) ?? "")
        .filter(Boolean);

    if (letters.length >= 2) return (letters[0] + letters[1]).toLocaleUpperCase();
    if (letters.length === 1) return letters[0].toLocaleUpperCase();

    // Nothing in it is a letter or a digit: a name of punctuation, or an
    // emoji. Take the first character as it is rather than answering nothing.
    return [...trimmed][0] ?? "?";
}

/**
 * The palette. Theme tokens rather than hex, so a site that changes its
 * colours changes these too - a palette written into a component is one that
 * stops matching the moment somebody picks another theme.
 *
 * Ten, because a list of twenty members wants more than a handful before two
 * of them collide, and because more than this stops reading as a palette and
 * starts reading as noise.
 */
const TONES = [
    "bg-[color-mix(in_srgb,var(--color-primary)_75%,black)]",
    "bg-[color-mix(in_srgb,var(--color-primary)_55%,white)]",
    "bg-[color-mix(in_srgb,var(--color-accent)_75%,black)]",
    "bg-[color-mix(in_srgb,var(--color-accent)_55%,white)]",
    "bg-[color-mix(in_srgb,var(--color-success)_70%,black)]",
    "bg-[color-mix(in_srgb,var(--color-success)_50%,white)]",
    "bg-[color-mix(in_srgb,var(--color-warning)_70%,black)]",
    "bg-[color-mix(in_srgb,var(--color-destructive)_70%,black)]",
    "bg-[color-mix(in_srgb,var(--color-primary)_60%,var(--color-accent))]",
    "bg-[color-mix(in_srgb,var(--color-accent)_60%,var(--color-success))]",
] as const;

/**
 * Which of them this name gets, the same one every time.
 *
 * Lower-cased first: the same member appears as `Steve` in one list and
 * `steve` in another, and two colours for one person is worse than none. The
 * hash is the small string hash every language's standard library has had
 * since the seventies - it needs to spread names, not resist an attacker.
 */
export function avatarTone(name: string): string {
    const key = (name ?? "").trim().toLocaleLowerCase();
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
        hash = (hash * 31 + key.charCodeAt(index)) | 0;
    }
    return TONES[Math.abs(hash) % TONES.length];
}
