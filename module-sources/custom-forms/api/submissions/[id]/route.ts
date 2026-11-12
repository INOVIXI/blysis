import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, logActivity, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { DECISION_STATES, submissionUpdateSchema } from "../../../lib/validations";

/**
 * One submission: move it on, or throw it away.
 *
 * The module shipped neither. A row's `status` was decided when it was
 * created and no endpoint ever wrote the column again, so the three words the
 * screen drew - new, read, handled - were a label on something nobody could
 * change. And a form left open collects whatever is sent to it; the panel's
 * answer to a run of nonsense was to page past it.
 *
 * Admin only, both of them. The granular per-form grant lets somebody read a
 * form's submissions without being an administrator of the site, and reading
 * is a different thing from deciding what happens to somebody's message.
 *
 * `submissionUpdateSchema` holds the state to `SUBMISSION_STATES`, so a state
 * outside the list the module owns is a 400 rather than a column quietly
 * holding a word nothing on the screen has a name for. The same write can
 * carry a note to the person who sent it, which they read beside the
 * decision on their own list.
 *
 * A change of state fires `customforms.submission.reviewed`, so another
 * module can tell the member or act on an approval.
 */

type RouteParams = { params: Promise<{ id: string }> };

async function requireAdmin(): Promise<string | NextResponse> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return session.user.id;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = submissionUpdateSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { id } = await params;
    // Read first: updating a row that is not there is a 404, not a 500.
    const existing = await prisma.customFormSubmission.findUnique({
        where: { id },
        select: { id: true, formId: true, userId: true, status: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { status, reviewNote } = parsed.data;
    const moved = status !== undefined && status !== existing.status ? status : null;
    const data: Record<string, unknown> = {};
    if (moved) data.status = moved;
    if (reviewNote !== undefined) data.reviewNote = reviewNote || null;
    if (moved && DECISION_STATES.includes(moved)) data.reviewedAt = new Date();

    const submission = await prisma.customFormSubmission.update({ where: { id }, data });

    if (moved) {
        const { doActionAsync } = await import("@/core/sdk");
        await doActionAsync("customforms.submission.reviewed", {
            formId: existing.formId,
            submissionId: id,
            userId: existing.userId,
            status: moved,
            previousStatus: existing.status,
        });
        // A decision reaches a person; the inbox steps before it do not.
        if (DECISION_STATES.includes(moved)) {
            logActivity({
                userId: who,
                action: "form_submission.review",
                entity: "CustomFormSubmission",
                entityId: id,
                metadata: { formId: existing.formId, status: moved },
            }).catch(() => {});
        }
    }
    return NextResponse.json({ submission });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const { id } = await params;
    const existing = await prisma.customFormSubmission.findUnique({
        where: { id },
        select: { id: true, formId: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.customFormSubmission.delete({ where: { id } });
    // Somebody's message left the site on an administrator's say-so, which is
    // the kind of change the log exists to carry.
    await logActivity({
        userId: who,
        action: "form_submission.delete",
        entity: "CustomFormSubmission",
        entityId: id,
        metadata: { formId: existing.formId },
    });
    return NextResponse.json({ ok: true });
}
