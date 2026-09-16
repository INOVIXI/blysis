import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { Prisma } from "@prisma/client";
import { themeRegistry } from "@/core/generated/theme-registry";
import type { ThemeFieldDef } from "@/core/lib/theme-manifest-schema";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";

/**
 * A bag of theme setting values. The values themselves stay `unknown`:
 * `sanitizeByType` below decides what each one may be from the theme's own
 * field declaration, and a value it does not recognise is dropped.
 */
const themeSettingsSchema = z.object({
    values: z.record(z.string().max(128), z.unknown()),
});

function sanitizeByType(def: ThemeFieldDef, value: unknown): unknown {
    switch (def.type) {
        case "color":    return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ? value : undefined;
        case "font":     return typeof value === "string" && value.length <= 100 ? value : undefined;
        case "select":   return typeof value === "string" && def.options.some(o => o.value === value) ? value : undefined;
        case "slider":   return typeof value === "number" && Number.isFinite(value) && value >= def.min && value <= def.max ? value : undefined;
        case "toggle":   return typeof value === "boolean" ? value : undefined;
        case "text":     return typeof value === "string" ? value.slice(0, def.max ?? 10000) : undefined;
        case "url":      return typeof value === "string" && (value.startsWith("/") || /^https?:\/\//.test(value)) ? value : undefined;
        case "richtext": return typeof value === "string" ? value.slice(0, def.max ?? 10000) : undefined;
        case "image":    return typeof value === "string" && (value.startsWith("/") || /^https?:\/\//.test(value) || value.startsWith("data:image/")) ? value : undefined;
        case "number":   return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; group: string }> }) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id, group } = await ctx.params;
    const rows = await prisma.themeSetting.findMany({ where: { themeId: id, groupKey: group } });
    return NextResponse.json({ values: Object.fromEntries(rows.map(r => [r.key, r.value])) });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; group: string }> }) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id, group } = await ctx.params;
    const manifest = themeRegistry[id];
    const groupDef = manifest?.settings?.[group];
    if (!groupDef) return NextResponse.json({ error: "Unknown theme or group" }, { status: 404 });

    const body = await readJsonBody(req);
    if (body instanceof NextResponse) return body;
    const parsed = themeSettingsSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "values required" }, { status: 400 });
    }

    const ops = [];
    for (const [key, raw] of Object.entries(parsed.data.values)) {
        const def = groupDef.fields[key];
        if (!def) continue;
        const clean = sanitizeByType(def, raw);
        if (clean === undefined) {
            ops.push(prisma.themeSetting.deleteMany({ where: { themeId: id, groupKey: group, key } }));
        } else {
            ops.push(prisma.themeSetting.upsert({
                where: { themeId_groupKey_key: { themeId: id, groupKey: group, key } },
                create: { themeId: id, groupKey: group, key, value: clean as Prisma.InputJsonValue, updatedById: session.user.id },
                update: { value: clean as Prisma.InputJsonValue, updatedById: session.user.id },
            }));
        }
    }
    await prisma.$transaction(ops);
    return NextResponse.json({ ok: true });
}
