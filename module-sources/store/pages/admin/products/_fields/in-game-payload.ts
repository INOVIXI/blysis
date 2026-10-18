/**
 * How a product or a shelf is shown in a connected game, as the form holds it
 * and as the API takes it. An empty text box means "use the site's own".
 */
export interface InGameValue {
    showInGame: boolean;
    gameTitle: string;
    gameDescription: string;
    gameIcon: string;
}

export const EMPTY_IN_GAME: InGameValue = { showInGame: false, gameTitle: "", gameDescription: "", gameIcon: "" };

export function inGameFrom(row: {
    showInGame?: boolean | null;
    gameTitle?: string | null;
    gameDescription?: string | null;
    gameIcon?: string | null;
}): InGameValue {
    return {
        showInGame: row.showInGame ?? false,
        gameTitle: row.gameTitle ?? "",
        gameDescription: row.gameDescription ?? "",
        gameIcon: row.gameIcon ?? "",
    };
}

export function inGamePayload(value: InGameValue) {
    return {
        showInGame: value.showInGame,
        gameTitle: value.gameTitle.trim() || null,
        gameDescription: value.gameDescription.trim() || null,
        gameIcon: value.gameIcon.trim() || null,
    };
}
