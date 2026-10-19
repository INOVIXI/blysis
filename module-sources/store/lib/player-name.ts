/**
 * What a buyer may type as the name a purchase is delivered to.
 *
 * The name is written into a console command on a game server. A space ends
 * an argument there, so "Steve 999999" in "eco give {player} 100" paid Steve
 * 999999; a character delivery has to strip turns one name into another,
 * "St@eve" into Steve. A name is asked for in the shape a game name has, and
 * anything else is refused at the till, where the buyer can still fix it.
 */
export const PLAYER_NAME = /^[A-Za-z0-9_.-]{1,50}$/;

export function isPlayerName(name: string): boolean {
    return PLAYER_NAME.test(name.trim());
}
