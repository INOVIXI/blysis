/** How a refused chest or gift action is said to a game server. */
import { NextResponse } from "next/server";
import { refuse } from "./auth";

const MESSAGES: Record<string, string> = {
    not_found: "No such item.",
    already_claimed: "That item was already claimed.",
    not_pending: "That gift is not waiting any more.",
    needs_player_name: "Nobody was named to deliver it to.",
    unavailable: "The store cannot do that right now.",
};

export function refused(code: string): NextResponse {
    return refuse(code === "unavailable" ? 503 : 409, code, MESSAGES[code] ?? "Refused.");
}
