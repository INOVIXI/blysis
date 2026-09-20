import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { CHANGELOG_TONES, DEFAULT_TYPES, nextKindOrder } from "../../lib/types";

/**
 * The kinds of release this community names.
 *
 * Six were an array in the source with a colour and a translation key each.
 * Six good words, and six is not every community's six: nobody could add
 * "Known issue" and nobody could take one away.
 *
 * Admin, all of it. A visitor needs the kinds to draw a badge, and gets them
 * with the entry they asked for rather than from a second request to a second
 * endpoint - the timeline is rendered on the server and reads them directly.
 */

const KEY = /^[a-z0-9][a-z0-9-]*$/;

const createSchema = z.object({
    key: z.string().min(1).max(32).regex(KEY, "a key is lower case letters, digits and hyphens"),
    name: z.string().trim().min(1).max(64),
    tone: z.enum(CHANGELOG_TONES),
    order: z.number().int().min(0).max(10_000).optional(),
});

const updateSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(64).optional(),
    tone: z.enum(CHANGELOG_TONES).optional(),
    order: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
});

async function requireAdmin(): Promise<string | NextResponse> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "changelog.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return session.user.id;
}

/**
 * Seeded on the first read rather than at boot.
 *
 * A module's hook runs once per process and this table has to exist before
 * the first release is written, so the read that needs it is the one that
 * fills it. Only when it is empty: once an operator has renamed or removed
 * one of the six, putting them back would be overturning their decision every
 * time the server restarts.
 */
async function ensureSeeded(): Promise<void> {
    const count = await prisma.changelogType.count();
    if (count > 0) return;
    await prisma.changelogType.createMany({
        data: DEFAULT_TYPES.map((kind) => ({ ...kind })),
        skipDuplicates: true,
    });
}

/**
 * GET /api/v1/changelog/types - the kinds of release this site publishes.
 *
 * Two readers, both operators, and only one of them wants the live list. The
 * entry form picks a kind to file a new entry under, so a kind that was
 * retired does not belong there. The screen that manages the kinds has to see
 * the retired ones, or the switch that retires one removes it from the only
 * screen that could bring it back.
 *
 * Both answers are admin-only either way: this endpoint has never been public.
 */
export async function GET(request: NextRequest) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;
    await ensureSeeded();
    const everything = new URL(request.url).searchParams.get("scope") === "admin";
    const types = await prisma.changelogType.findMany({
        where: everything ? {} : { isActive: true },
        orderBy: [{ order: "asc" }, { key: "asc" }],
        select: { id: true, key: true, name: true, nameKey: true, tone: true, order: true, isActive: true },
    });
    return NextResponse.json({ types });
}

export async function POST(request: NextRequest) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    // A key already in use would take over every release written under it,
    // which is a rename nobody asked for.
    const taken = await prisma.changelogType.findUnique({ where: { key: parsed.data.key } });
    if (taken) {
        return NextResponse.json({ error: "That key is taken", code: "key_taken" }, { status: 409 });
    }

    // One row, not the table: the question is only where the list ends.
    const highest = await prisma.changelogType.findFirst({
        orderBy: { order: "desc" },
        select: { order: true },
    });
    const type = await prisma.changelogType.create({
        data: { ...parsed.data, order: parsed.data.order ?? nextKindOrder(highest?.order ?? null) },
    });
    await logActivity({
        userId: who,
        action: "changelog_type.create",
        entity: "ChangelogType",
        entityId: type.id,
        metadata: { key: type.key },
    });
    return NextResponse.json({ type }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { id, ...changes } = parsed.data;
    const existing = await prisma.changelogType.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    /*
     * Renaming one of the six drops its `nameKey`.
     *
     * Otherwise the key would keep winning and the operator's word would
     * never appear - the screen would accept the edit and show the old
     * translation back, which is the worst of both.
     */
    const type = await prisma.changelogType.update({
        where: { id },
        data: changes.name !== undefined ? { ...changes, nameKey: null } : changes,
    });
    return NextResponse.json({ type });
}

export async function DELETE(request: NextRequest) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "id required" }, { status: 400 });

    const existing = await prisma.changelogType.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, key: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Releases written under it keep their `type` string and print it as it
    // stands, which is what the label has always done for a kind it does not
    // know. Rewriting their column would be changing history to tidy a list.
    await prisma.changelogType.delete({ where: { id: existing.id } });
    const orphaned = await prisma.changelogEntry.count({ where: { type: existing.key } });
    await logActivity({
        userId: who,
        action: "changelog_type.delete",
        entity: "ChangelogType",
        entityId: existing.id,
        metadata: { key: existing.key, entriesLeftHolding: orphaned },
    });
    return NextResponse.json({ ok: true, entriesLeftHolding: orphaned });
}
