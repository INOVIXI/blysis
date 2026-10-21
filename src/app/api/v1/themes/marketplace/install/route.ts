import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import { scheduleBuild } from "@/core/lib/install-lock";
import AdmZip from "adm-zip";
import { logActivity } from "@/core/lib/activity-log";
import { validateZipEntries } from "@/core/lib/module-zip-validator";
import { themeMarketplaceBase } from "@/core/lib/marketplace-source";
import { resolveWithin } from "@/core/lib/runtime-paths";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";
import { devOnlyDetail } from "@/core/lib/api-utils";
import { log } from "@/core/lib/logger";
import { toolCommand } from "@/core/lib/tool-command";

/** Which catalogue theme to fetch. The regex checks below still apply. */
const installThemeSchema = z.object({
    themeId: z.string().max(64),
    zipFile: z.string().max(200),
});

const THEMES_DIR = path.join(process.cwd(), "src/themes");

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const jsonBody = await readJsonBody(request);
        if (jsonBody instanceof NextResponse) return jsonBody;
        const parsed = installThemeSchema.safeParse(jsonBody);
        if (!parsed.success) return NextResponse.json({ error: "themeId and zipFile required" }, { status: 400 });
        const { themeId, zipFile } = parsed.data;

        // Validate inputs to prevent SSRF / path traversal
        if (!/^[a-z0-9-]+\.zip$/.test(zipFile)) {
            return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
        }
        if (!/^[a-z0-9-]+$/.test(themeId)) {
            return NextResponse.json({ error: "Invalid theme ID" }, { status: 400 });
        }

        const targetDir = resolveWithin(THEMES_DIR, themeId);
        if (!targetDir) {
            return NextResponse.json({ error: "Invalid theme ID" }, { status: 400 });
        }
        if (await fs.access(targetDir).then(() => true).catch(() => false)) {
            return NextResponse.json({ error: "Theme already installed" }, { status: 409 });
        }

        // Download ZIP with size limit
        const res = await fetch(`${themeMarketplaceBase()}/${zipFile}`);
        if (!res.ok) return NextResponse.json({ error: `Download failed: HTTP ${res.status}` }, { status: 502 });

        const contentLength = res.headers.get("content-length");
        const MAX_THEME_SIZE = 50 * 1024 * 1024; // 50MB
        if (contentLength && parseInt(contentLength, 10) > MAX_THEME_SIZE) {
            return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 });
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > MAX_THEME_SIZE) {
            return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 });
        }

        // Validate ZIP magic number
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
            return NextResponse.json({ error: "Invalid ZIP file" }, { status: 400 });
        }

        // Extract using adm-zip (no shell, path traversal protected)
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();

        // Same defense in depth as the module marketplace install: enforce
        // symlink rejection, extension allowlist, max entry count, max
        // uncompressed size, and zip-bomb compression-ratio limits before
        // touching the filesystem. Without this, a crafted theme ZIP can
        // ship symlinks pointing outside the theme dir or balloon to
        // hundreds of GB on disk.
        const contentCheck = validateZipEntries(entries);
        if (!contentCheck.ok) {
            return NextResponse.json({ error: contentCheck.error ?? "ZIP validation failed" }, { status: 400 });
        }

        await fs.mkdir(targetDir, { recursive: true });
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const resolvedPath = path.resolve(targetDir, entry.entryName);
            if (!resolvedPath.startsWith(path.resolve(targetDir) + path.sep)) continue;
            const dir = path.dirname(resolvedPath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(resolvedPath, entry.getData());
        }

        // Read the manifest rather than asking whether it is there and then
        // reading it: two syscalls with a gap between them, one answer needed.
        const manifestPath = path.join(targetDir, "theme.json");
        try {
            await fs.readFile(manifestPath, "utf-8");
        } catch {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json({ error: "Invalid theme - no theme.json" }, { status: 400 });
        }

        // Regenerate theme registry
        try {
            execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-theme-registry.ts"]), { cwd: process.cwd(), timeout: 30000, stdio: "pipe" });
        } catch (err: unknown) {
            await fs.rm(targetDir, { recursive: true, force: true });
            log.error("[themes] registry generation failed, install rolled back", {
                error: String((err as Error)?.message || err),
            });
            return NextResponse.json(
                { error: "Theme registry generation failed", details: devOnlyDetail(err) },
                { status: 400 },
            );
        }

        // Deferred, debounced rebuild + process replacement. Running the
        // build inline held the HTTP thread for three minutes (a self-DoS for
        // the admin) and then "restarted" through a pm2 binary that is in
        // neither the image nor package.json.
        scheduleBuild();

        logActivity({
            userId: session.user.id,
            action: "theme.install",
            entity: "theme",
            entityId: themeId,
            metadata: { zipFile },
        }).catch(() => {});

        return NextResponse.json({ message: "Theme installed", theme: { id: themeId } });
    } catch (err: unknown) {
        log.error("[themes] installing from the marketplace failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json(
            { error: "Operation failed", details: devOnlyDetail(err) },
            { status: 500 },
        );
    }
}
