import { NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { auth } from "@/core/lib/auth";
import { rateLimit, getClientIP } from "@/core/lib/rate-limit";
import { exportUserData, buildExportReadme } from "@/core/lib/user-data-export";
import { getSeoSiteInfo } from "@/core/lib/seo";
import { logActivity } from "@/core/lib/activity-log";
import { log } from "@/core/lib/logger";

// GET /api/v1/auth/profile/export
// Returns a ZIP of the authenticated user's personal data.
// Rate limited to 3 requests per hour per user because the query fan-out
// is heavy and we don't want someone DoSing us by hammering this.
export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const rl = await rateLimit(`profile-export:${userId}`, {
        maxRequests: 3,
        windowMs: 60 * 60 * 1000,
    });
    if (!rl.success) {
        return NextResponse.json(
            { error: "Too many export requests. Try again later.", code: "rate_limited" },
            { status: 429 }
        );
    }

    try {
        const data = await exportUserData(userId);
        const exportedAt = new Date();
        const readme = buildExportReadme(userId, exportedAt, (await getSeoSiteInfo()).siteName);
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
            userId,
            action: "user.data.exported",
            entity: "User",
            entityId: userId,
            ipAddress: getClientIP(request.headers),
        });

        const filename = `blysis-data-${userId}-${exportedAt
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
        log.error("[profile-export] failed", { error: err instanceof Error ? err.message : String(err) });
        return NextResponse.json(
            { error: "Failed to build export", code: "export_failed" },
            { status: 500 }
        );
    }
}
