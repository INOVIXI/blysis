import { NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { placeholderSources, resolvePlaceholders } from "@/core/lib/placeholders";

/**
 * GET /api/v1/admin/placeholders
 *
 * What an operator can write into a text that takes site placeholders: each
 * one's name, the module that answers it, the key its label is under in the
 * panel's translations, an example and its value right now. The picker
 * translates the label itself, as the sidebar does a module's menu entry.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id, session.user.role))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [sources, { values }] = await Promise.all([placeholderSources(), resolvePlaceholders({ budgetMs: 3000 })]);
    return NextResponse.json({
        placeholders: sources.map((source) => ({
            name: source.name,
            module: source.module,
            labelKey: source.labelKey,
            example: source.example,
            value: values[source.name] ?? null,
        })),
    });
}
