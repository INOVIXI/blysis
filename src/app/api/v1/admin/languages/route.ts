import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { invalidate } from "@/core/lib/cache";
import { prisma } from "@/core/lib/db";
import { locales } from "@/core/lib/i18n/config";
import { siteLanguagesOf } from "@/core/lib/i18n/site-languages";
import {
    DEFAULT_LOCALE_KEY,
    SITE_LANGUAGES_KEY,
    getSiteLanguages,
    invalidateSiteLanguages,
} from "@/core/lib/i18n/site-languages-setting";
import { isAdmin } from "@/core/lib/permissions";

/**
 * Which languages the site offers, and which it opens in.
 *
 * Its own route rather than two keys through `/api/v1/settings`, which takes
 * any value for any key: a site offering no language, or opening in one it
 * does not offer, is refused here by name. Both keys are written together,
 * and the caches the proxy and the footer read are dropped, so the next page
 * a visitor opens is already in the new set.
 */

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: apiError("Unauthorized", 401) };
    if (!(await isAdmin(session.user.id, session.user.role))) return { error: apiError("Forbidden", 403) };
    return { session };
}

export async function GET() {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    invalidateSiteLanguages();
    return apiSuccess(await getSiteLanguages());
}

const languagesSchema = z.object({
    offered: z.array(z.enum(locales)).min(1).max(locales.length),
    preferred: z.enum(locales),
}).refine((body) => body.offered.includes(body.preferred), {
    message: "The site cannot open in a language it does not offer",
    path: ["preferred"],
});

export async function PUT(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = languagesSchema.safeParse(body);
    if (!parsed.success) {
        // The pair check runs beside the field checks, so it is the answer
        // only when it is the one complaint.
        const opensUnoffered = parsed.error.issues.every((issue) => issue.code === "custom");
        return apiError(parsed.error.issues[0]?.message || "Invalid input", 400, {
            code: opensUnoffered ? "languages_default_not_offered" : "languages_invalid",
        });
    }
    const site = siteLanguagesOf(parsed.data.offered, parsed.data.preferred);

    await prisma.$transaction([
        prisma.setting.upsert({
            where: { key: SITE_LANGUAGES_KEY },
            update: { value: site.offered },
            create: { key: SITE_LANGUAGES_KEY, value: site.offered },
        }),
        prisma.setting.upsert({
            where: { key: DEFAULT_LOCALE_KEY },
            update: { value: site.preferred },
            create: { key: DEFAULT_LOCALE_KEY, value: site.preferred },
        }),
    ]);
    invalidateSiteLanguages();
    await invalidate("public-settings");

    logActivity({
        userId: guard.session?.user?.id,
        action: "languages.update",
        entity: "settings",
        entityId: SITE_LANGUAGES_KEY,
        metadata: { offered: site.offered, preferred: site.preferred },
    }).catch(() => {});

    return apiSuccess(site);
}
