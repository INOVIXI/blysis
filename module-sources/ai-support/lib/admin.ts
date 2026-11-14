/**
 * Who may do what with the support assistant.
 *
 * `ai-support.manage` reads its record and changes its settings. Using a
 * draft on a ticket, `ai-support.use`, is for whoever answers tickets, and a
 * manager may do it too. Every administrator holds both.
 */
import { NextResponse } from "next/server";
import { hasPermission } from "@/core/sdk/server";

export const MANAGE = "ai-support.manage";
export const USE = "ai-support.use";

/** Takes the caller's session, so each route reads it where a reader expects to see it. */
export async function requireAny(
    session: { user?: { id?: string | null } | null } | null,
    permissions: readonly string[],
): Promise<{ userId: string } | NextResponse> {
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    for (const permission of permissions) {
        if (await hasPermission(userId, permission)) return { userId };
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/** What a draft can be, as the record shows it. */
export const DRAFT_STATUSES = ["draft", "sent", "used", "discarded", "stale", "failed"] as const;
