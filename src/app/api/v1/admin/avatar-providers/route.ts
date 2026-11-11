import { NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { ModuleAvatarProviders } from "@/core/generated/module-data";

/**
 * GET /api/v1/admin/avatar-providers - the picture services a member's face
 * may come from, for the picker beside the member picture setting.
 *
 * The registry is server-only, and core has no list of its own to draw the
 * picker from, so the panel asks. Only the providers of switched-on modules:
 * offering one that draws nothing would be a choice that saves and does not
 * work.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const states = await getModuleStates();
    const providers = ModuleAvatarProviders
        .filter((p) => isEnabledIn(states, p.module))
        .map((p) => ({ id: p.id, labelKey: p.labelKey, host: p.host }));
    return NextResponse.json({ providers });
}
