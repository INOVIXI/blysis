import { NextRequest, NextResponse } from "next/server";
import { challengeFieldsFrom, getClientIP, isAdmin, prisma, rateLimitForRoleAsync, readJsonBody, runChallenge } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { checkAnswers, formSubmissionSchema, formUpdateSchema, storedFieldsSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const { slug } = await params;
    const form = await prisma.customForm.findFirst({
        where: { OR: [{ slug }, { id: slug }], isActive: true },
    });
    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
    return NextResponse.json({ form });
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

    const submission = await prisma.customFormSubmission.create({
        data: {
            formId: form.id,
            userId: session?.user?.id || null,
            data,
        },
    });

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

    const data: Record<string, unknown> = {};
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.description !== undefined) data.description = fields.description;
    if (fields.fields !== undefined) data.fields = fields.fields;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const updated = await prisma.customForm.update({ where: { id: form.id }, data });

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

    await prisma.customForm.delete({ where: { id: form.id } });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("customforms.form.deleted", form);

    return NextResponse.json({ message: "Deleted" });
}
