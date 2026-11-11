import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { hasPassword, signInMethodsOf } from "@/core/lib/sign-in-methods";

type RouteParams = { params: Promise<{ id: string }> };

/** GET - a member's connected sign-in methods, for their screen in the panel. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const [methods, password] = await Promise.all([signInMethodsOf(id), hasPassword(id)]);
    return NextResponse.json({ methods, hasPassword: password });
}
