import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { logActivity } from "@/core/lib/activity-log";
import {
    MAINTENANCE_MESSAGE_MAX,
    getMaintenanceConfig,
    setMaintenanceConfig,
    type MaintenanceConfig,
} from "@/core/lib/maintenance";
import { readJsonBody } from "@/core/lib/api-body";
import { isTranslatableText, longestText, type TranslatableText } from "@/core/lib/i18n/translatable-text";

const configSchema = z.object({
    enabled: z.boolean(),
    // Written per language or once for all of them; each language is held
    // to the same length one message always was.
    message: z.custom<TranslatableText>(
        (value) => isTranslatableText(value) && longestText(value) <= MAINTENANCE_MESSAGE_MAX,
    ).optional(),
    allowedRoles: z.array(z.string().min(1).max(50)).max(20).optional(),
});

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const config = await getMaintenanceConfig();
    return NextResponse.json({ data: config });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid payload", issues: parsed.error.issues },
            { status: 400 }
        );
    }

    const next: MaintenanceConfig = {
        enabled: parsed.data.enabled,
        message: parsed.data.message ?? "",
        allowedRoles:
            parsed.data.allowedRoles && parsed.data.allowedRoles.length > 0
                ? parsed.data.allowedRoles
                : ["admin"],
    };

    await setMaintenanceConfig(next);

    logActivity({
        userId: session.user.id,
        action: next.enabled ? "maintenance.enable" : "maintenance.disable",
        entity: "setting",
        entityId: "maintenance_mode",
        metadata: {
            enabled: next.enabled,
            allowedRoles: next.allowedRoles,
        },
    }).catch(() => {});

    return NextResponse.json({ data: next });
}
