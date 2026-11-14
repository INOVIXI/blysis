import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { logActivity } from "@/core/lib/activity-log";
import { prisma } from "@/core/lib/db";
import { ModuleModerationProviders, ModuleModerationReviewers } from "@/core/generated/module-moderation";
import { getModuleStates } from "@/core/lib/module-cache";
import { readJsonBody } from "@/core/lib/api-body";
import { pageParams } from "@/core/lib/page-params";
import { log } from "@/core/lib/logger";
import { resolveLocaleFromRequest } from "@/core/lib/i18n/resolve-locale";
import { decide, latestDecisions } from "@/core/lib/moderation-decisions";
import { reviewerStatus } from "@/core/lib/moderation-review";

/** A reviewer's name as its manifest gives it; its id once it is uninstalled. */
function reviewerName(id: string | null): string | null {
    if (!id) return null;
    return ModuleModerationReviewers.find((r) => r.id === id)?.name ?? id;
}

async function loadActiveProviders() {
    const states = await getModuleStates();
    return ModuleModerationProviders.filter((p) => states[p.module] !== false);
}

/**
 * GET /api/v1/admin/moderation?type=<provider-id>&page=1[&state=rejected]
 * Returns pending items for one provider, or with `state=rejected` what it
 * rejected, each beside its latest decision. When type is omitted, returns
 * the per-provider pending counts, whether each has a Rejected view, and
 * which reviewing module is on (`reviewerConflict` when more than one is,
 * since then none reviews).
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const providers = await loadActiveProviders();
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get("type");
    const rejected = searchParams.get("state") === "rejected";
    const perPage = 20;
    const { page, skip, take } = pageParams(searchParams, { fixedLimit: perPage });

    if (!typeParam) {
        const counts: Record<string, number> = {};
        const labels: Record<string, {
            label: string;
            labelKey?: string;
            settingKey?: string;
            settingLabelKey?: string;
            settingDescKey?: string;
            canListRejected: boolean;
        }> = {};
        await Promise.all(
            providers.map(async (p) => {
                const meta = {
                    label: p.label,
                    labelKey: p.labelKey,
                    settingKey: p.settingKey,
                    settingLabelKey: p.settingLabelKey,
                    settingDescKey: p.settingDescKey,
                };
                try {
                    const mod = await p.loader();
                    counts[p.id] = await mod.default.count();
                    labels[p.id] = { ...meta, canListRejected: typeof mod.default.listRejected === "function" };
                } catch {
                    counts[p.id] = 0;
                    labels[p.id] = { ...meta, canListRejected: false };
                }
            }),
        );
        const { reviewer, conflict } = await reviewerStatus();
        return NextResponse.json({ counts, types: labels, reviewer, reviewerConflict: conflict });
    }

    const provider = providers.find((p) => p.id === typeParam);
    if (!provider) {
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    try {
        const mod = await provider.loader();
        const impl = mod.default;
        if (rejected && !impl.listRejected) {
            return NextResponse.json({ error: "This kind keeps no list of what it rejected", code: "not_supported" }, { status: 400 });
        }
        const { items, total } = rejected ? await impl.listRejected!(skip, take) : await impl.list(skip, take);
        const decisions = await latestDecisions(provider.id, items.map((i) => i.id), await resolveLocaleFromRequest());
        return NextResponse.json({
            items: items.map((i) => {
                const decision = decisions.get(i.id) ?? null;
                return {
                    ...i,
                    type: provider.id,
                    ...(rejected
                        ? { decision: decision ? { ...decision, reviewer: reviewerName(decision.reviewer) } : null }
                        // Waiting because its author asked a person: a moderator
                        // should know no reviewer will take it off their hands.
                        : { askedPerson: decision?.humanOnly === true }),
                };
            }),
            total,
            page,
            pages: Math.max(1, Math.ceil(total / perPage)),
        });
    } catch (err) {
        log.error("[moderation] fetch failed", { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ items: [], total: 0, page: 1, pages: 1 });
    }
}

const actionSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100),
    type: z.string().min(1),
    action: z.enum(["approve", "reject", "requeue"]),
    reasonId: z.string().min(1).optional(),
    note: z.string().trim().max(500).optional(),
});

const STATE_FOR = { approve: "APPROVED", reject: "REJECTED", requeue: "PENDING" } as const;

/**
 * POST /api/v1/admin/moderation
 * Body: { ids, type, action: "approve" | "reject" | "requeue", reasonId?, note? }
 * A rejection names one of the site's enabled reasons; approving or
 * requeueing works from any state, which is how a rejection is taken back.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid" }, { status: 400 });
    }

    const providers = await loadActiveProviders();
    const provider = providers.find((p) => p.id === parsed.data.type);
    if (!provider) {
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const { ids, action, reasonId, note } = parsed.data;
    if (action === "reject") {
        if (!reasonId) {
            return NextResponse.json({ error: "A rejection needs a reason", code: "reason_required" }, { status: 400 });
        }
        const reason = await prisma.moderationReason.findUnique({ where: { id: reasonId }, select: { enabled: true } });
        if (!reason?.enabled) {
            return NextResponse.json({ error: "Unknown reason", code: "reason_unknown" }, { status: 400 });
        }
    }

    let affected: string[];
    try {
        const mod = await provider.loader();
        ({ affected } = await decide(
            { id: provider.id, impl: mod.default },
            {
                ids,
                state: STATE_FOR[action],
                reasonId: action === "reject" ? reasonId : null,
                note: note || null,
                decidedById: session.user.id,
            },
        ));
    } catch (err) {
        log.error("[moderation] action failed", { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json({ error: "Operation failed" }, { status: 500 });
    }

    logActivity({
        userId: session.user.id,
        action: `moderation.${action}`,
        entity: provider.id,
        metadata: { ids: affected, count: affected.length, ...(reasonId ? { reasonId } : {}) },
    }).catch(() => { });

    return NextResponse.json({ ok: true, affected: affected.length });
}
