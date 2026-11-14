/**
 * GET /api/v1/ai-support/admin/options - what the settings screen offers:
 * the desk's departments and priorities and the knowledge sources installed,
 * each named in `?locale=`.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/sdk/auth";
import { MANAGE, requireAny } from "../../../lib/admin";
import { departments, knowledgeSources, priorities } from "../../../lib/desk";

export async function GET(request: NextRequest) {
    const session = await auth();
    const manager = await requireAny(session, [MANAGE]);
    if (manager instanceof NextResponse) return manager;
    const locale = (new URL(request.url).searchParams.get("locale") ?? "").slice(0, 16);
    const [deskDepartments, deskPriorities, sources] = await Promise.all([departments(locale), priorities(locale), knowledgeSources(locale)]);
    return NextResponse.json({ departments: deskDepartments, priorities: deskPriorities, sources });
}
