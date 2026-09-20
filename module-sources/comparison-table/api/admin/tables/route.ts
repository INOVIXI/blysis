import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { storedCells, type DraftCell } from "../../../lib/table-payload";

/**
 * The tables an operator writes, whole.
 *
 * A table is a shape, not a list of rows: columns, groups, rows and the cells
 * between them only mean anything together. Saving it a piece at a time means
 * a reader can arrive on a comparison with the new columns and the old cells,
 * which is a table stating things nobody wrote. So a save replaces the whole
 * thing in one transaction.
 *
 * Replacing rather than diffing is deliberate too. Nothing outside this module
 * holds a row or a cell id - a column's `href` is the only thing that points
 * anywhere, and that is data - so the simplest correct write is to delete the
 * children and lay down what the operator has now, with the client's own keys
 * mapped to fresh ids on the way in.
 *
 * With one exception, and it is the whole reason this file changed: a table
 * about a subject does not own its columns. They are the things inside that
 * subject - the products on a shelf - and they are reconciled on read. Deleting
 * and recreating them here would give every column a new id on every save, and
 * the cells hang off those ids: an operator would fill in a grid, press save,
 * and find it empty. So for those tables the columns are left alone and the
 * cells arrive keyed by the column ids the editor was given.
 */

const cellSchema = z.object({
    rowKey: z.string().min(1).max(64),
    columnKey: z.string().min(1).max(64),
    kind: z.enum(["yes", "no", "value", "unstated"]),
    value: z.string().max(200).optional().nullable(),
});

const tableSchema = z.object({
    id: z.string().max(64).optional().nullable(),
    slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens"),
    title: z.string().min(1).max(160),
    description: z.string().max(1000).optional().nullable(),
    isActive: z.boolean().default(true),
    order: z.number().int().min(0).max(9999).default(0),
    /** What the table is about. Null means the operator types the columns. */
    subjectRef: z.string().max(160).optional().nullable(),
    columns: z.array(z.object({
        key: z.string().min(1).max(64),
        label: z.string().min(1).max(120),
        subtitle: z.string().max(200).optional().nullable(),
        href: z.string().max(500).optional().nullable(),
        highlight: z.boolean().default(false),
    })).max(12),
    groups: z.array(z.object({
        key: z.string().min(1).max(64),
        label: z.string().min(1).max(120),
    })).max(30),
    rows: z.array(z.object({
        key: z.string().min(1).max(64),
        groupKey: z.string().max(64).optional().nullable(),
        label: z.string().min(1).max(200),
    })).max(200),
    cells: z.array(cellSchema).max(2400),
});

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!(await isAdmin(session.user.id))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    return { session };
}

/** Every table, including the ones switched off, which the public list hides. */
export async function GET() {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const tables = await prisma.comparisonTable.findMany({
        orderBy: [{ order: "asc" }, { title: "asc" }],
        include: {
            columns: { orderBy: { order: "asc" } },
            groups: { orderBy: { order: "asc" } },
            rows: { orderBy: { order: "asc" }, include: { cells: true } },
        },
        take: 50,
    });
    return NextResponse.json({ tables }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = tableSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message, code: "invalid_table" }, { status: 400 });
    }
    const draft = parsed.data;

    const clash = await prisma.comparisonTable.findFirst({
        where: { slug: draft.slug, ...(draft.id ? { NOT: { id: draft.id } } : {}) },
        select: { id: true },
    });
    if (clash) {
        return NextResponse.json({ error: "That address is taken", code: "slug_taken" }, { status: 409 });
    }

    // Read before the write: the update below sets the new subject, so asking
    // the row afterwards compares a value to itself and never sees a change.
    const previousSubject = draft.id
        ? (await prisma.comparisonTable.findUnique({
            where: { id: draft.id },
            select: { subjectRef: true },
        }))?.subjectRef ?? null
        : null;

    const tableId = await prisma.$transaction(async (tx) => {
        const table = draft.id
            ? await tx.comparisonTable.update({
                where: { id: draft.id },
                data: {
                    slug: draft.slug,
                    title: draft.title,
                    description: draft.description ?? null,
                    isActive: draft.isActive,
                    order: draft.order,
                    subjectRef: draft.subjectRef || null,
                },
            })
            : await tx.comparisonTable.create({
                data: {
                    slug: draft.slug,
                    title: draft.title,
                    description: draft.description ?? null,
                    isActive: draft.isActive,
                    order: draft.order,
                    subjectRef: draft.subjectRef || null,
                },
            });

        // Columns belong to the subject where there is one. Changing the
        // subject is the one case where they do not survive: they describe
        // the old one, and so do the answers in them.
        const boundToSubject = Boolean(draft.subjectRef);
        const subjectChanged = Boolean(draft.id) && previousSubject !== (draft.subjectRef || null);

        // Cells hang off rows and columns, so both cascades clear them.
        await tx.comparisonRow.deleteMany({ where: { tableId: table.id } });
        if (!boundToSubject || subjectChanged) {
            await tx.comparisonColumn.deleteMany({ where: { tableId: table.id } });
        }
        await tx.comparisonGroup.deleteMany({ where: { tableId: table.id } });

        // The ids are made here rather than by the database, so the key the
        // editor used can be mapped before anything is written and the whole
        // table goes down in four statements instead of one per row. A
        // transaction held open for a round trip per row is a table nobody
        // else can read for as long as the operator's connection takes.
        // A subject's columns keep the ids they already have, because the
        // cells the operator just filled in are keyed to them.
        const columnId = new Map(
            boundToSubject && !subjectChanged
                ? draft.columns.map((column) => [column.key, column.key])
                : draft.columns.map((column) => [column.key, crypto.randomUUID()]),
        );
        const groupId = new Map(draft.groups.map((group) => [group.key, crypto.randomUUID()]));
        const rowId = new Map(draft.rows.map((row) => [row.key, crypto.randomUUID()]));

        if (draft.columns.length > 0 && (!boundToSubject || subjectChanged)) {
            await tx.comparisonColumn.createMany({
                data: draft.columns.map((column, at) => ({
                    id: columnId.get(column.key) as string,
                    tableId: table.id,
                    label: column.label,
                    subtitle: column.subtitle ?? null,
                    href: column.href?.trim() || null,
                    highlight: column.highlight,
                    order: at,
                })),
            });
        }

        if (draft.groups.length > 0) {
            await tx.comparisonGroup.createMany({
                data: draft.groups.map((group, at) => ({
                    id: groupId.get(group.key) as string,
                    tableId: table.id,
                    label: group.label,
                    order: at,
                })),
            });
        }

        if (draft.rows.length > 0) {
            await tx.comparisonRow.createMany({
                data: draft.rows.map((row, at) => ({
                    id: rowId.get(row.key) as string,
                    tableId: table.id,
                    // A row pointing at a group the operator removed keeps its
                    // place in the table rather than following it out.
                    groupId: row.groupKey ? groupId.get(row.groupKey) ?? null : null,
                    label: row.label,
                    order: at,
                })),
            });
        }

        // The unstated cells are dropped here rather than stored as "no". See
        // `table-payload.ts` for why that is the whole point of this endpoint.
        // A subject's columns were never deleted, so a cell may name one the
        // draft did not carry; `known` is what actually exists to hang off.
        const known = new Set(
            (await tx.comparisonColumn.findMany({ where: { tableId: table.id }, select: { id: true } }))
                .map((column) => column.id),
        );
        const cells = storedCells(draft.cells.map((cell): DraftCell => ({
            rowId: rowId.get(cell.rowKey) ?? "",
            columnId: (() => {
                const mapped = columnId.get(cell.columnKey) ?? "";
                return known.has(mapped) ? mapped : "";
            })(),
            kind: cell.kind,
            value: cell.value ?? null,
        })));
        if (cells.length > 0) {
            await tx.comparisonCell.createMany({ data: cells });
        }

        return table.id;
    });

    logActivity({
        userId: guard.session?.user?.id,
        action: "comparison-table.saved",
        entity: "comparison_table",
        entityId: tableId,
        metadata: { slug: draft.slug, columns: draft.columns.length, rows: draft.rows.length },
    }).catch(() => {});

    return NextResponse.json({ id: tableId });
}

const deleteSchema = z.object({ id: z.string().min(1).max(64) });

export async function DELETE(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    // A table is the operator's own content and points at nothing outside this
    // module, so this one really is a delete. Its children go with it.
    const gone = await prisma.comparisonTable.deleteMany({ where: { id: parsed.data.id } });
    if (gone.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    logActivity({
        userId: guard.session?.user?.id,
        action: "comparison-table.deleted",
        entity: "comparison_table",
        entityId: parsed.data.id,
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
}
