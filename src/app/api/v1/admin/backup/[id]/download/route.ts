import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { getBackupPath } from "@/core/lib/backup";
import fs from "fs";
import path from "path";
import { BACKUPS_DIR } from "@/core/lib/runtime-paths";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/admin/backup/[id]/download
 * Stream the gzipped SQL dump as an attachment. Validates that the resolved
 * path lives inside the backups/ directory to prevent path traversal.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const fullPath = await getBackupPath(id);
    if (!fullPath) {
        return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }

    // Defence-in-depth: ensure the resolved path is inside BACKUPS_DIR
    const normalised = path.resolve(fullPath);
    if (!normalised.startsWith(BACKUPS_DIR + path.sep)) {
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const stat = fs.statSync(normalised);
    const filename = path.basename(normalised);
    const nodeStream = fs.createReadStream(normalised);

    const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
            nodeStream.on("data", (chunk: Buffer | string) => {
                const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
                controller.enqueue(new Uint8Array(buf));
            });
            nodeStream.on("end", () => controller.close());
            nodeStream.on("error", (err) => controller.error(err));
        },
        cancel() {
            nodeStream.destroy();
        },
    });

    return new NextResponse(webStream, {
        headers: {
            "Content-Type": "application/gzip",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(stat.size),
            "Cache-Control": "no-store",
        },
    });
}
