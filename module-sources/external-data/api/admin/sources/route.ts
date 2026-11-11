import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { attachContentTranslations, contentTranslationsInput, deleteContentTranslations, isAdmin, logActivity, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { DEFAULT_CONNECTION_KEY } from "../../../lib/connection";
import { readExternalList } from "../../../lib/read";
import { SOURCE_TEXT, SOURCE_TRANSLATED_FIELDS, boundedSource, checkSourceDraft } from "../../../lib/source-draft";

/**
 * The sources an operator defines, and a way to find out whether one works.
 *
 * The refusals here are not the endpoint's own opinion: they come from the
 * same `safeIdentifier` the reader uses, so a name that would be refused at
 * read time is refused at save time instead of being stored and failing on
 * every page view afterwards.
 *
 * The trial run is why this endpoint has a POST as well as a PUT. An operator
 * typing a table name into a production admin has otherwise no way to find out
 * whether it exists until a visitor does, and the answer comes back through
 * `errors.ts` - the kind of failure, never the driver's own sentence, which
 * names the host, the user and sometimes the password in full.
 *
 * The connection string never leaves the server. A source names which stored
 * connection to use and this answers with rows, never with credentials.
 */

const sourceSchema = z.object({
    id: z.string().max(64).optional().nullable(),
    slug: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
    settingKey: z.string().max(120).default(""),
    table: z.string().min(1).max(63),
    columns: z.array(z.string().max(63)).max(40),
    orderBy: z.string().max(63).default(""),
    descending: z.boolean().default(true),
    rowLimit: z.number().int().min(1).max(1000).default(20),
    cacheSeconds: z.number().int().min(5).max(86_400).default(60),
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

    const sources = await prisma.externalSource.findMany({
        orderBy: { title: "asc" },
        take: 100,
    });
    // With every language of each title, for the editor's language boxes.
    return NextResponse.json(
        { sources: await attachContentTranslations(prisma, SOURCE_TEXT, sources) },
        { headers: { "Cache-Control": "private, no-store" } },
    );
}

export async function PUT(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = sourceSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid input", code: "invalid_source" }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, SOURCE_TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error, code: "invalid_source" }, { status: 400 });
    const draft = parsed.data;

    const refusal = checkSourceDraft(draft);
    if (refusal) {
        return NextResponse.json(
            { error: "That source would not run", code: `source_${refusal}` },
            { status: 400 },
        );
    }

    const clash = await prisma.externalSource.findFirst({
        where: { slug: draft.slug, ...(draft.id ? { NOT: { id: draft.id } } : {}) },
        select: { id: true },
    });
    if (clash) {
        return NextResponse.json({ error: "That address is taken", code: "slug_taken" }, { status: 409 });
    }

    const bounds = boundedSource(draft);
    const data = {
        slug: draft.slug.trim(),
        title: draft.title.trim(),
        settingKey: draft.settingKey.trim(),
        table: draft.table.trim(),
        columns: draft.columns.map((column) => column.trim()).filter((column) => column !== ""),
        orderBy: draft.orderBy.trim(),
        descending: draft.descending,
        rowLimit: bounds.rowLimit,
        cacheSeconds: bounds.cacheSeconds,
        isActive: draft.isActive,
    };

    const source = await prisma.$transaction(async (tx) => {
        const saved = draft.id
            ? await tx.externalSource.update({ where: { id: draft.id }, data })
            : await tx.externalSource.create({ data });
        if (translations.value) await saveContentTranslations(tx, { ...SOURCE_TEXT, recordId: saved.id }, translations.value);
        return saved;
    });

    logActivity({
        userId: guard.session?.user?.id,
        action: "external-data.source.saved",
        entity: "external_source",
        entityId: source.id,
        // The table and the columns, not the connection: an activity row is
        // read in more places than this screen is.
        metadata: { slug: source.slug, table: source.table, columns: source.columns.length },
    }).catch(() => {});

    return NextResponse.json({ source });
}

const trialSchema = sourceSchema.omit({ id: true, isActive: true });

/** A trial run of a source as it stands, before it is saved or after. */
export async function POST(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = trialSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid input", code: "invalid_source" }, { status: 400 });
    }
    const draft = parsed.data;

    const refusal = checkSourceDraft({ ...draft });
    if (refusal) {
        return NextResponse.json(
            { error: "That source would not run", code: `source_${refusal}` },
            { status: 400 },
        );
    }

    const key = draft.settingKey.trim() || DEFAULT_CONNECTION_KEY;
    const connection = await prisma.setting.findUnique({ where: { key } });
    const connectionString = typeof connection?.value === "string" ? connection.value.trim() : "";
    if (connectionString === "") {
        return NextResponse.json(
            { error: "There is no connection saved yet", code: "external_not_connected" },
            { status: 503 },
        );
    }

    const bounds = boundedSource(draft);
    const answer = await readExternalList(connectionString, {
        table: draft.table,
        columns: draft.columns,
        orderBy: draft.orderBy,
        descending: draft.descending,
        // A trial reads a handful. The point is whether it answers, not how
        // much of somebody else's database this site can pull in one go.
        limit: Math.min(5, bounds.rowLimit),
    });

    if ("failed" in answer) {
        return NextResponse.json(
            { error: answer.message, code: `external_${answer.failed.replace(/-/g, "_")}` },
            { status: 502 },
        );
    }

    return NextResponse.json({ rows: answer.rows, columns: draft.columns });
}

const deleteSchema = z.object({ id: z.string().min(1).max(64) });

export async function DELETE(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const gone = await prisma.$transaction(async (tx) => {
        const result = await tx.externalSource.deleteMany({ where: { id: parsed.data.id } });
        await deleteContentTranslations(tx, SOURCE_TEXT, [parsed.data.id]);
        return result;
    });
    if (gone.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    logActivity({
        userId: guard.session?.user?.id,
        action: "external-data.source.deleted",
        entity: "external_source",
        entityId: parsed.data.id,
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
}
