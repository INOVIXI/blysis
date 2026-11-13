import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { isAdmin } from "@/core/lib/permissions";
import { readJsonBody } from "@/core/lib/api-body";
import { logActivity } from "@/core/lib/activity-log";
import { readSettingValues } from "@/core/lib/setting-values";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { ModuleAiPurposes } from "@/core/generated/module-data";
import { activeAiProviderId, aiProviderStatus } from "@/core/lib/ai";
import { ACTIVE_AI_PROVIDER_KEY } from "@/core/lib/ai-key";
import { AI_SETTING_BOUNDS, AI_SETTING_KEYS, aiSettingsFrom } from "@/core/lib/ai-settings";
import { usageOverDays } from "@/core/lib/ai-usage";

/**
 * GET   /api/v1/admin/ai - providers, the active one, limits, usage and what leaves the site.
 * PATCH /api/v1/admin/ai - the choice of provider and the limits; any subset.
 *
 * A limit outside its bounds is refused rather than clamped: the operator
 * would otherwise read back a number they did not type.
 */

const USAGE_WINDOW_DAYS = 30;

function whole(bounds: { min: number; max: number }) {
    return z.number().int().min(bounds.min).max(bounds.max);
}

const bodySchema = z.object({
    active: z.string().min(1).max(64).nullable().optional(),
    timeoutSeconds: whole(AI_SETTING_BOUNDS.timeoutSeconds).optional(),
    dailyTokenLimit: whole(AI_SETTING_BOUNDS.dailyTokenLimit).optional(),
    requestsPerMinute: whole(AI_SETTING_BOUNDS.requestsPerMinute).optional(),
    retentionDays: whole(AI_SETTING_BOUNDS.retentionDays).optional(),
    moduleTokenLimits: z
        .record(z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/), whole(AI_SETTING_BOUNDS.dailyTokenLimit))
        .refine((limits) => Object.keys(limits).length <= 200)
        .optional(),
}).strict();

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { session };
}

export async function GET() {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const [providers, active, values, states, usage] = await Promise.all([
        aiProviderStatus(),
        activeAiProviderId(),
        readSettingValues([ACTIVE_AI_PROVIDER_KEY, ...Object.values(AI_SETTING_KEYS)]),
        getModuleStates(),
        usageOverDays(USAGE_WINDOW_DAYS),
    ]);
    const chosen = values[ACTIVE_AI_PROVIDER_KEY];

    return NextResponse.json({
        providers,
        active,
        chosen: typeof chosen === "string" && chosen ? chosen : null,
        settings: aiSettingsFrom(values),
        bounds: AI_SETTING_BOUNDS,
        purposes: ModuleAiPurposes.filter((purpose) => isEnabledIn(states, purpose.module)),
        usage,
        windowDays: USAGE_WINDOW_DAYS,
    });
}

export async function PATCH(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid", code: "ai_setting_invalid" }, { status: 400 });
    }
    const input = parsed.data;

    if (typeof input.active === "string") {
        const installed = (await aiProviderStatus()).map((provider) => provider.id);
        if (!installed.includes(input.active)) {
            return NextResponse.json({ error: "That provider is not installed", code: "ai_provider_unknown" }, { status: 400 });
        }
    }

    const writes: [string, Prisma.InputJsonValue][] = [];
    if (typeof input.active === "string") writes.push([ACTIVE_AI_PROVIDER_KEY, input.active]);
    if (input.timeoutSeconds !== undefined) writes.push([AI_SETTING_KEYS.timeoutSeconds, input.timeoutSeconds]);
    if (input.dailyTokenLimit !== undefined) writes.push([AI_SETTING_KEYS.dailyTokenLimit, input.dailyTokenLimit]);
    if (input.requestsPerMinute !== undefined) writes.push([AI_SETTING_KEYS.requestsPerMinute, input.requestsPerMinute]);
    if (input.retentionDays !== undefined) writes.push([AI_SETTING_KEYS.retentionDays, input.retentionDays]);
    if (input.moduleTokenLimits !== undefined) writes.push([AI_SETTING_KEYS.moduleTokenLimits, input.moduleTokenLimits]);

    await prisma.$transaction([
        ...writes.map(([key, value]) =>
            prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value, module: "core" } }),
        ),
        // Null is "nobody chosen": with one provider installed it answers
        // alone, with several every call waits for the operator again.
        ...(input.active === null ? [prisma.setting.deleteMany({ where: { key: ACTIVE_AI_PROVIDER_KEY } })] : []),
    ]);

    logActivity({
        userId: guard.session?.user?.id,
        action: "ai.settings.update",
        entity: "setting",
        entityId: "ai",
        metadata: { changed: [...writes.map(([key]) => key), ...(input.active === null ? [ACTIVE_AI_PROVIDER_KEY] : [])] },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
}
