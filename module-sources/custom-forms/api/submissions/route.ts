import { NextRequest, NextResponse } from "next/server";
import { pageParams, isAdmin, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { canAccessForm } from "../../lib/can-access-form";
import { SUBMISSION_STATES, type SubmissionState } from "../../lib/validations";

// GET /api/v1/forms/submissions - list submissions.
// Access:
//   - admin / custom-forms.manage role perm → all forms
//   - users with a granular "custom-forms.form" view grant → only that form
//     (a formId query param is required in this case)
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formId = request.nextUrl.searchParams.get("formId");
    const { page, limit, skip, take } = pageParams(request.nextUrl.searchParams, { defaultLimit: 50 });

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        // Non-admins must scope the listing to a single form and must have
        // either the role perm or a granular grant on that specific form.
        if (!formId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (!(await canAccessForm(session.user.id, formId, "view"))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }

    /*
     * Narrowing happens here, not in the browser.
     *
     * The screen offered one control - which form - over a list paged fifty
     * at a time, so finding the message somebody is asking about meant paging
     * until it appeared. A submission's answers are a Json column, which
     * Postgres will not match with `contains` on the column itself; the cast
     * to text is what makes "the word they wrote" a thing that can be looked
     * for at all, and it is why the term is matched case-insensitively
     * against the whole answer set rather than one field.
     */
    const term = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const requested = request.nextUrl.searchParams.get("status");
    const status = SUBMISSION_STATES.includes(requested as SubmissionState) ? requested : null;

    const where: Record<string, unknown> = {};
    if (formId) where.formId = formId;
    if (status) where.status = status;

    // The ids a free text term matches, or null when nothing was typed. A
    // separate query because the answers live in Json: the alternative is
    // reading every row into the process and filtering there, which is the
    // thing paging exists to avoid.
    let matched: string[] | null = null;
    if (term) {
        const rows = await prisma.$queryRaw<{ id: string }[]>`
            SELECT s."id"
            FROM "CustomFormSubmission" s
            JOIN "CustomForm" f ON f."id" = s."formId"
            WHERE s."data"::text ILIKE ${`%${term}%`} OR f."title" ILIKE ${`%${term}%`}
            LIMIT 5000
        `;
        matched = rows.map((row) => row.id);
        where.id = { in: matched };
    }

    const [submissions, total] = await Promise.all([
        prisma.customFormSubmission.findMany({
            where,
            include: {
                // The questions, so an answer can be shown under the one that
                // was asked rather than under the column it is stored in.
                form: { select: { id: true, title: true, slug: true, fields: true } },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take,
        }),
        prisma.customFormSubmission.count({ where }),
    ]);

    /*
     * Who sent each one, by name.
     *
     * `userId` is a loose reference on purpose - the schema declares no
     * relation, so this module does not depend on the User model and an
     * anonymous submission is valid. That decision is about the column, not
     * about the screen: the panel was printing the raw id at an operator, who
     * has no way to turn one into a person. A second read by id keeps both.
     * An id that resolves to nothing is a member who has since been deleted,
     * and their submission says so rather than naming a ghost.
     */
    const senderIds = [...new Set(submissions.map((row) => row.userId).filter((id): id is string => !!id))];
    const senders = senderIds.length
        ? await prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, username: true } })
        : [];
    const nameById = new Map(senders.map((user) => [user.id, user.username]));

    // Every state's count over the whole table, not over the page: a strip
    // that counts the rows in front of the reader is a strip that lies.
    const byState = await prisma.customFormSubmission.groupBy({
        by: ["status"],
        where: formId || matched ? { ...where, status: undefined } : undefined,
        _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const state of SUBMISSION_STATES) counts[state] = 0;
    for (const row of byState) counts[row.status] = row._count._all;

    return NextResponse.json({
        submissions: submissions.map((row) => ({
            ...row,
            sentBy: row.userId ? (nameById.get(row.userId) ?? null) : null,
        })),
        total,
        counts,
        pages: Math.ceil(total / limit),
    });
}
