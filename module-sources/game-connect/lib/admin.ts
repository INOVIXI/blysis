/**
 * Who may manage connected servers and the delivery queue: a signed-in member
 * holding `game-connect.manage`, which every administrator does.
 */
import { NextResponse } from "next/server";
import { hasPermission } from "@/core/sdk/server";

export const MANAGE = "game-connect.manage";

/** Takes the caller's session, so each route reads it where a reader expects to see it. */
export async function requireManager(
    session: { user?: { id?: string | null } | null } | null,
): Promise<{ userId: string } | NextResponse> {
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(userId, MANAGE))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return { userId };
}
