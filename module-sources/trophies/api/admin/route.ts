import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { invalidate, isAdmin, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { RULES_MODES, trophyRuleSchema } from "../../lib/validations";

/**
 * Admin trophy CRUD.
 *
 * GET  /api/v1/admin/trophies        - list with award counts
 * POST /api/v1/admin/trophies        - create a new trophy
 *
 * All routes require the caller to pass `isAdmin()`.
 */

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id || !(await isAdmin(session.user.id, session.user.role))) {
        return null;
    }
    return session;
}

export async function GET() {
    if (!(await requireAdmin())) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const trophies = await prisma.trophy.findMany({
        orderBy: [{ isActive: "desc" }, { points: "desc" }, { name: "asc" }],
        include: { _count: { select: { users: true } } },
        take: 200,
    });

    return NextResponse.json({ trophies });
}

const createSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().nullable(),
    icon: z.string().max(50).optional().nullable(),
    color: z.string().max(50).optional().nullable(),
    points: z.number().int().min(0).default(0),
    ruleType: z.string().max(50).optional().nullable(),
    ruleEvent: z.string().max(120).optional().nullable(),
    ruleThreshold: z.number().int().min(1).optional().nullable(),
    // A trophy can wait for more than one thing. The two columns above stay,
    // holding the first of them, so anything still reading those - an export,
    // an installation whose engine has not been updated - sees a rule rather
    // than nothing.
    rules: z.array(trophyRuleSchema).max(20).optional().nullable(),
    rulesMode: z.enum(RULES_MODES).optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
    const session = await requireAdmin();
    if (!session) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message || "Invalid input" },
            { status: 400 }
        );
    }

    const data = parsed.data;
    const trophy = await prisma.trophy.create({
        data: {
            name: data.name,
            description: data.description ?? null,
            icon: data.icon ?? null,
            color: data.color ?? null,
            points: data.points ?? 0,
            ruleType: data.ruleType ?? "event-count",
            ruleEvent: data.ruleEvent || null,
            ruleThreshold: data.ruleThreshold ?? 1,
            // The list, where the screen sent one. Named explicitly rather
            // than spread, which is why `layout` went missing from the store's
            // categories for as long as it did.
            rules: data.rules ?? undefined,
            rulesMode: data.rulesMode ?? "all",
            isActive: data.isActive ?? true,
            // Keep legacy awardOn in sync so older consumers keep working.
            awardOn: data.ruleEvent ? `${data.ruleEvent}:${data.ruleThreshold ?? 1}` : null,
        },
    });

    await invalidate("trophies:public");

    logActivity({
        userId: session.user.id,
        action: "trophy.create",
        entity: "trophy",
        entityId: trophy.id,
        metadata: { name: trophy.name, points: trophy.points },
    }).catch(() => {});

    return NextResponse.json({ trophy }, { status: 201 });
}
