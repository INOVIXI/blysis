/**
 * GET /api/v1/admin/export - what can be exported, and the file itself.
 *
 * With no `type` it answers the list, which is what the screen draws its
 * buttons from. The screen used to hold that list itself and got it wrong:
 * three buttons against an endpoint that knew one of them, so two of the
 * three opened a tab showing `{"error":"Invalid type. Use: users"}`.
 *
 * With a `type` it answers the file, streamed. The rows and the file are
 * never held whole - see `lib/csv.ts` for what that cost before.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin, logActivity } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { csvStream } from "../../lib/csv";
import { findExport, listExports } from "../../lib/exports";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const type = request.nextUrl.searchParams.get("type");
    if (!type) {
        // The name and the id only. Whatever reads the rows stays on this
        // side of the wire.
        const offered = await listExports();
        return NextResponse.json({
            exports: offered.map((one) => ({ id: one.id, labelKey: one.labelKey })),
        });
    }

    const source = await findExport(type);
    if (!source) {
        return NextResponse.json({ error: "Nothing installed here exports that", code: "unknown_export" }, { status: 400 });
    }

    // Recorded before the first row leaves, because the export is the act that
    // was authorised; whether the transfer completes is the network's business.
    await logActivity({
        userId: session.user.id,
        action: "data_exported",
        metadata: { type: source.id, format: "csv" },
    });

    return new NextResponse(csvStream(source), {
        headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${source.id}-export-${Date.now()}.csv"`,
        },
    });
}
