import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { exportUserData, buildExportReadme } from "@/core/lib/user-data-export";
import { getSeoSiteInfo } from "@/core/lib/seo";
import { logActivity } from "@/core/lib/activity-log";
import { getClientIP } from "@/core/lib/rate-limit";
import { log } from "@/core/lib/logger";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/users/[id]/export (admin-only)
// Used by support / legal teams to fulfil GDPR data-access requests on
// behalf of a user.
export async function GET(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: targetId } = await params;

    try {
        const data = await exportUserData(targetId);
        const exportedAt = new Date();
        const readme = buildExportReadme(targetId, exportedAt, (await getSeoSiteInfo()).siteName);
        const jsonPayload = JSON.stringify(
            { exportedAt: exportedAt.toISOString(), ...data },
            null,
            2
        );

        const zip = new AdmZip();
        zip.addFile("user-data.json", Buffer.from(jsonPayload, "utf-8"));
        zip.addFile("README.txt", Buffer.from(readme, "utf-8"));
        const zipBuffer = zip.toBuffer();

        await logActivity({
            userId: session.user.id,
            action: "admin.user.data_exported",
            entity: "User",
            entityId: targetId,
            ipAddress: getClientIP(request.headers),
        });

        const filename = `blysis-data-${targetId}-${exportedAt
            .toISOString()
            .slice(0, 10)}.zip`;

        return new NextResponse(new Uint8Array(zipBuffer), {
            status: 200,
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Content-Length": String(zipBuffer.length),
                "Cache-Control": "no-store",
            },
        });
    } catch (err) {
        log.error("[admin-user-export] failed", { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json(
            { error: "Failed to build export" },
            { status: 500 }
        );
    }
}
