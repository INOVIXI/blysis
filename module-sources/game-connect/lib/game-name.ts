/**
 * A game as a sentence names it.
 *
 * A link stores its game the way a server said hello, in lower case, so a
 * player's account reads "the minecraft account Alex". In a sentence the
 * game is a name, and a name starts with a capital.
 */
export function gameName(platform: string): string {
    const trimmed = platform.trim();
    return trimmed === "" ? trimmed : trimmed.charAt(0).toLocaleUpperCase("en") + trimmed.slice(1);
}
