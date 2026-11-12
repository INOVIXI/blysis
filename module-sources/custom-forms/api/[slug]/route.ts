import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, challengeFieldsFrom, contentTranslationsInput, deleteContentTranslations, getClientIP, isAdmin, prisma, rateLimitForRoleAsync, readContentTranslations, readJsonBody, runChallenge, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { checkAnswers, formSubmissionSchema, formUpdateSchema, limitWithoutSignIn, storedFieldsSchema } from "../../lib/validations";
import { usedAllowance } from "../../lib/allowance";
import { memberStatus } from "../../lib/member-status";
import { FORM_TEXT, formTextLimits, translateForm, withStaleCleared } from "../../lib/form-text";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/v1/forms/[slug] - one form, read in `?locale=`.
 *
 * `scope=admin` is the builder's answer: the form as stored, closed or not,
 * with every language of its words, and refused to anybody who is not an
 * admin. The builder read the visitor's answer before, so a form an operator
 * closed could not be opened for editing.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { slug } = await params;
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const stored = await prisma.customForm.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
        if (!stored) return NextResponse.json({ error: "Form not found" }, { status: 404 });
        const [form] = await attachContentTranslations(prisma, FORM_TEXT, [stored]);
        return NextResponse.json({ form });
    }
    const form = await prisma.customForm.findFirst({
        where: { OR: [{ slug }, { id: slug }], isActive: true },
    });
    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });

    const translated = await translateForm(prisma, form, query.get("locale") ?? "");

    /*
     * Who is reading, as far as this form cares: a visitor is told to sign
     * in where the form asks for it, and a member sees what they already
     * sent and what was decided, so an application that has been answered
     * is not a blank form inviting them to send it again.
     */
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ form: translated, viewer: { signedIn: false } });

    const [used, sent] = await Promise.all([
        usedAllowance(prisma, form, userId),
        prisma.customFormSubmission.findMany({
            where: { formId: form.id, userId },
            select: { id: true, status: true, reviewNote: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 10,
        }),
    ]);
    return NextResponse.json({
        form: translated,
        viewer: {
            signedIn: true,
            used,
            limit: form.requireSignIn ? form.submissionLimit : null,
            submissions: sent.map((row) => ({ ...row, status: memberStatus(row.status) })),
        },
    });
}

// Submit form
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { slug } = await params;
    const session = await auth();

    const ip = getClientIP(request.headers);
    const identifier = session?.user?.id ? `custom-forms:submit:${session.user.id}` : `custom-forms:submit:${ip}`;
    const allowed = await rateLimitForRoleAsync(
        identifier,
        { maxRequests: 5, windowMs: 60_000 },
        session?.user?.role
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const form = await prisma.customForm.findFirst({
        where: { OR: [{ slug }, { id: slug }], isActive: true },
    });
    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });

    // Before anything is read: the page shows a visitor a prompt instead of
    // this form, and the rule has to hold for a post that skipped the page.
    const userId = session?.user?.id ?? null;
    if (form.requireSignIn && !userId) {
        return NextResponse.json({ error: "Sign in to send this form", code: "sign_in_required" }, { status: 401 });
    }

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;

    /*
     * Whatever check the operator put in front of this form, asked before
     * anything is written and before the answers are even looked at.
     *
     * This is the one form on the site somebody with no account can write
     * through, so a rate limit per address was all that stood between it and
     * a script. With no challenge module installed there are no listeners and
     * this passes, so a site that never wanted one behaves as it did.
     *
     * The challenge field is deliberately outside `formSubmissionSchema`: the
     * shape of what a challenge module collects is that module's business.
     */
    const challenge = await runChallenge({
        action: "forms.submit",
        fields: challengeFieldsFrom(jsonBody),
        ip,
    });
    if (!challenge.ok) {
        return NextResponse.json({ error: "Challenge failed", reason: challenge.code }, { status: 400 });
    }

    const parsed = formSubmissionSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: "Form data required" }, { status: 400 });
    }
    const { data } = parsed.data;

    // The questions are already in hand; this is checking the answers against
    // them rather than storing whatever was sent and finding out on the admin
    // screen. The reason travels as a code so the page can say it in the
    // visitor's language.
    const questions = storedFieldsSchema.safeParse(form.fields);
    const problem = questions.success ? checkAnswers(questions.data, data) : null;
    if (problem) {
        return NextResponse.json({ error: "Form data rejected", ...problem }, { status: 400 });
    }

    const record = { formId: form.id, userId, data };
    const limit = form.requireSignIn && userId ? form.submissionLimit : null;
    /*
     * The count and the write under one lock per member and form, held to
     * the end of the transaction: counted and then written separately, two
     * tabs sending at once would both find the last place free.
     */
    const submission = limit === null || !userId
        ? await prisma.customFormSubmission.create({ data: record })
        : await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`custom-forms:${form.id}:${userId}`}))`;
            if ((await usedAllowance(tx, form, userId)) >= limit) return null;
            return tx.customFormSubmission.create({ data: record });
        });
    if (!submission) {
        return NextResponse.json({ error: "You have already sent this form", code: "limit_reached" }, { status: 409 });
    }

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("customforms.submission.created", { form, submission });

    // Private activity feed entry (only if logged in)
    if (session?.user?.id) {
        await prisma.activityFeedItem.create({
            data: {
                type: "customforms.submission.created",
                actorId: session.user.id,
                title: `Submitted form: ${form.title}`,
                href: `/forms/${form.slug}`,
                icon: "ClipboardList",
                isPublic: false,
            },
        }).catch(() => {});
    }

    return NextResponse.json({ submission }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const form = await prisma.customForm.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsedUpdate = formUpdateSchema.safeParse(body);
    if (!parsedUpdate.success) {
        return NextResponse.json({ error: "Validation failed", details: parsedUpdate.error.flatten() }, { status: 400 });
    }
    const fields = parsedUpdate.data;
    // Translatable words are read off the questions the form will have after
    // this write: the ones sent, or the ones it already has.
    const limits = formTextLimits(fields.fields ?? form.fields);
    const translations = contentTranslationsInput(body, limits);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const requireSignIn = fields.requireSignIn ?? form.requireSignIn;
    const submissionLimit = fields.submissionLimit !== undefined ? fields.submissionLimit : form.submissionLimit;
    if (limitWithoutSignIn(requireSignIn, submissionLimit)) {
        return NextResponse.json({ error: "A limit needs sign-in", code: "limit_needs_sign_in" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.description !== undefined) data.description = fields.description;
    if (fields.fields !== undefined) data.fields = fields.fields;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.requireSignIn !== undefined) data.requireSignIn = fields.requireSignIn;
    if (fields.submissionLimit !== undefined) data.submissionLimit = fields.submissionLimit;

    const updated = await prisma.$transaction(async (tx) => {
        const written = await tx.customForm.update({ where: { id: form.id }, data });
        // New questions may have left old words behind; they go whether or
        // not this request named any translation.
        const stored = fields.fields !== undefined
            ? (await readContentTranslations(tx, FORM_TEXT, [form.id])).get(form.id)
            : undefined;
        const save = withStaleCleared(translations.value, stored, limits);
        if (Object.keys(save).length > 0) await saveContentTranslations(tx, { ...FORM_TEXT, recordId: form.id }, save);
        return written;
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("customforms.form.updated", updated);

    return NextResponse.json({ form: updated });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const form = await prisma.customForm.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
        await tx.customForm.delete({ where: { id: form.id } });
        await deleteContentTranslations(tx, FORM_TEXT, [form.id]);
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("customforms.form.deleted", form);

    return NextResponse.json({ message: "Deleted" });
}
