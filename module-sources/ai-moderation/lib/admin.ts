/**
 * Who may read the AI reviewer's decisions, change its settings and take its
 * decisions back: a signed-in member holding `ai-moderation.manage`, which
 * every administrator does.
 */
import { NextResponse } from "next/server";
import { hasPermission } from "@/core/sdk/server";

export const MANAGE = "ai-moderation.manage";

/** Takes the caller's session, so each route reads it where a reader expects to see it. */
export async function requireManager(
    session: { user?: { id?: string | null } | null } | null,
): Promise<{ userId: string } | NextResponse> {
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(userId, MANAGE))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return { userId };
}

/** What the reviewer can answer core for an item. */
export const APPLIED = ["approve", "reject", "leave"] as const;
