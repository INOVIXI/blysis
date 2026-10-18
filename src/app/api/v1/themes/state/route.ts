import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { themeRegistry, defaultThemeId } from "@/core/generated/theme-registry";
import { setActiveTheme } from "@/core/lib/theme-state";
import { SYSTEM_MODE } from "@/core/lib/theme-mode";
import { COLOR_MODE_LOCK_SETTING } from "@/core/lib/color-mode";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";

/**
 * Which installed theme is active, the mode the site is drawn in for a
 * visitor who has not chosen - one the theme declares, or `system` to follow
 * the reader's operating system - and whether visitors may choose at all.
 */
const themeStateSchema = z.object({
    themeId: z.string().max(64),
    mode: z.string().max(64).optional(),
    locked: z.boolean().optional(),
});

/** `system` means something only for a theme that has both halves of it. */
function followsSystem(available: Record<string, unknown>): boolean {
    return "light" in available && "dark" in available;
}

async function readLocked(): Promise<boolean> {
    const row = await prisma.setting.findUnique({ where: { key: COLOR_MODE_LOCK_SETTING } }).catch(() => null);
    return row?.value === true;
}

export async function GET() {
    const [row, locked] = await Promise.all([prisma.themeState.findFirst(), readLocked()]);
    if (row) return NextResponse.json({ ...row, locked });

    // Fall back to the codegen-derived defaults so the response never
    // references a theme id that isn't actually installed. Hardcoding
    // "flat" violated the motto and broke clients on installations where
    // flat isn't present.
    const manifest = themeRegistry[defaultThemeId];
    return NextResponse.json({
        themeId: defaultThemeId,
        mode: manifest?.modes.default ?? "light",
        locked,
    });
}

export async function PUT(req: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await readJsonBody(req);
    if (body instanceof NextResponse) return body;

    const parsed = themeStateSchema.safeParse(body);
    const themeId = parsed.success ? parsed.data.themeId : null;
    const manifest = themeId ? themeRegistry[themeId] : null;
    if (!manifest || !themeId) return NextResponse.json({ error: "Unknown theme" }, { status: 404 });

    const requestedMode = parsed.success ? parsed.data.mode : undefined;
    const valid = (m: string | undefined): m is string =>
        !!m && (m in manifest.modes.available || (m === SYSTEM_MODE && followsSystem(manifest.modes.available)));
    const mode = valid(requestedMode) ? requestedMode : manifest.modes.default;

    await setActiveTheme(themeId, mode);
    const requestedLock = parsed.success ? parsed.data.locked : undefined;
    if (typeof requestedLock === "boolean") {
        await prisma.setting.upsert({
            where: { key: COLOR_MODE_LOCK_SETTING },
            create: { key: COLOR_MODE_LOCK_SETTING, value: requestedLock },
            update: { value: requestedLock },
        });
    }
    const locked = typeof requestedLock === "boolean" ? requestedLock : await readLocked();
    await logActivity({ userId: session.user.id, action: "theme.state.update", entity: "theme", entityId: themeId, metadata: { mode, locked } }).catch(() => {});
    return NextResponse.json({ ok: true, themeId, mode, locked });
}
