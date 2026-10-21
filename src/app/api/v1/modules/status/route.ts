import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/core/lib/db";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { secretsMatch } from "@/core/lib/constant-time";

// GET /api/v1/modules/status - Get enabled/disabled status of all modules
export async function GET(request: NextRequest) {
    // With no secret set the internal path is off: secretsMatch refuses an
    // empty expected value, so only an admin session gets through.
    const isInternalCall = secretsMatch(
        request.headers.get("x-internal-request"),
        process.env.INTERNAL_API_SECRET ?? "",
    );

    if (!isInternalCall) {
        const session = await auth();
        if (!session?.user?.id || !(await isAdmin(session.user.id))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    try {
        const configs = await prisma.moduleConfig.findMany({
            select: { id: true, enabled: true }
        });
        const modules: Record<string, boolean> = {};
        for (const c of configs) {
            modules[c.id] = c.enabled;
        }
        return NextResponse.json({ modules });
    } catch {
        return NextResponse.json({ modules: {} });
    }
}
