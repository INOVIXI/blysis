import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/**
 * The places an operator divides the record into.
 *
 * A scope is a name and a rule: what to call somewhere, and whether a
 * punishment handed down there also restricts this website. Both halves are
 * the operator's, because neither is ours to guess - one site runs Survival
 * and Skyblock off the same server and wants a Skyblock ban to cost nothing
 * here, another runs a Minecraft server and a CS:GO server and wants a ban on
 * either to close the forum account too.
 *
 * `matchKey` is the other half of the join: it is what a reporting module
 * calls the place, and it is never drawn. LiteBans says `server_scope`, which
 * on a real server is a string like `srv-2`. The GET hands back the keys that
 * have actually been arriving and have no scope, so an operator names what is
 * really there instead of guessing at spellings.
 *
 * Creating a scope claims the rows that were waiting for that key. Without
 * that, an operator who connects a server and then names its scopes would see
 * the division start from today and the history stay blank, which reads like
 * the feature is broken.
 */

const scopeSchema = z.object({
    id: z.string().max(64).optional().nullable(),
    name: z.string().trim().min(1).max(80),
    /** What the reporting system calls this place. Blank for a scope nothing reports into. */
    matchKey: z.string().trim().max(120).default(""),
    restrictsSite: z.boolean().default(false),
    order: z.number().int().min(0).max(9999).default(0),
    isActive: z.boolean().default(true),
});

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!(await isAdmin(session.user.id))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    return { session };
}

export async function GET() {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const scopes = await prisma.punishmentScope.findMany({
        orderBy: [{ order: "asc" }, { name: "asc" }],
        take: 100,
    });

    /*
     * What has been arriving under a key nothing claims. Bounded and grouped
     * rather than listed: a busy server reports the same handful of keys
     * across thousands of rows, and the operator needs the handful.
     */
    const unclaimed = await prisma.punishment.groupBy({
        by: ["scopeKey"],
        where: { scopeId: null, scopeKey: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { scopeKey: "desc" } },
        take: 20,
    });

    return NextResponse.json(
        {
            scopes,
            unclaimed: unclaimed.map((row) => ({ key: row.scopeKey, count: row._count._all })),
        },
        { headers: { "Cache-Control": "private, no-store" } },
    );
}

export async function PUT(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = scopeSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message, code: "invalid_scope" }, { status: 400 });
    }
    const draft = parsed.data;
    const matchKey = draft.matchKey || null;

    if (matchKey) {
        const clash = await prisma.punishmentScope.findFirst({
            where: { matchKey, ...(draft.id ? { NOT: { id: draft.id } } : {}) },
            select: { id: true },
        });
        // Two scopes claiming one key would make which one a punishment lands
        // in depend on the order rows come back in.
        if (clash) {
            return NextResponse.json({ error: "Another scope already claims that key", code: "key_taken" }, { status: 409 });
        }
    }

    const data = {
        name: draft.name,
        matchKey,
        restrictsSite: draft.restrictsSite,
        order: draft.order,
        isActive: draft.isActive,
    };

    const scope = draft.id
        ? await prisma.punishmentScope.update({ where: { id: draft.id }, data })
        : await prisma.punishmentScope.create({ data });

    // The rows that were waiting for this key, including the ones recorded
    // before anybody had named the place.
    const claimed = matchKey
        ? (await prisma.punishment.updateMany({
            where: { scopeKey: matchKey, scopeId: null },
            data: { scopeId: scope.id },
        })).count
        : 0;

    logActivity({
        userId: guard.session?.user?.id,
        action: "punishments.scope.saved",
        entity: "punishment_scope",
        entityId: scope.id,
        metadata: { name: scope.name, restrictsSite: scope.restrictsSite, claimed },
    }).catch(() => {});

    return NextResponse.json({ scope, claimed });
}

const deleteSchema = z.object({ id: z.string().min(1).max(64) });

export async function DELETE(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    /*
     * The punishments stay. Deleting a scope is the operator saying they no
     * longer divide the record that way, not that the punishments did not
     * happen - the rows fall back to unscoped, which is what they were before
     * anybody named the place, and they keep their `scopeKey` so remaking the
     * scope picks them up again.
     *
     * Unscoped means restricting again, and that is the safe direction: a
     * deleted scope must not be a way to quietly lift everything recorded in
     * it.
     */
    const gone = await prisma.punishmentScope.deleteMany({ where: { id: parsed.data.id } });
    if (gone.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    logActivity({
        userId: guard.session?.user?.id,
        action: "punishments.scope.deleted",
        entity: "punishment_scope",
        entityId: parsed.data.id,
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
}
