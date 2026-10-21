import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { rateLimit } from "@/core/lib/rate-limit";
import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { execFileSync } from "child_process";
import { themeManifestSchema } from "@/core/lib/theme-manifest-schema";
import { validateZipEntries } from "@/core/lib/module-zip-validator";
import { manifestHash } from "@/core/lib/module-install-audit";
import { PROJECT_ROOT } from "@/core/lib/runtime-paths";
import { devOnlyDetail } from "@/core/lib/api-utils";
import { themeRegistry } from "@/core/generated/theme-registry";
import { toolCommand } from "@/core/lib/tool-command";

const THEMES_DIR = path.join(PROJECT_ROOT, "src/themes");
// Generic non-theme reservations + every in-tree theme id (from the
// generated registry). Uploading over a shipped theme is disallowed; new
// theme ids are kept distinct from the core/admin route namespaces.
const RESERVED_IDS = new Set<string>(["core", "admin", ...Object.keys(themeRegistry)]);

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rl = await rateLimit(`theme-upload:${session.user.id}`, { maxRequests: 3, windowMs: 3_600_000 });
    if (!rl.success) return NextResponse.json({ error: "Too many uploads" }, { status: 429 });

    let extractDir: string | null = null;
    try {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.name.endsWith(".zip")) {
            return NextResponse.json({ error: "Upload a .zip" }, { status: 400 });
        }
        if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "File too large (max 20MB)" }, { status: 413 });

        const buffer = Buffer.from(await file.arrayBuffer());
        if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return NextResponse.json({ error: "Invalid ZIP" }, { status: 400 });

        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        const check = validateZipEntries(entries);
        if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

        extractDir = path.join(PROJECT_ROOT, "tmp", `theme-extract-${Date.now()}`);
        await fs.mkdir(extractDir, { recursive: true });
        const extractRoot = path.resolve(extractDir);
        for (const e of entries) {
            if (e.isDirectory) continue;
            const resolved = path.resolve(extractDir, e.entryName);
            if (!resolved.startsWith(extractRoot + path.sep)) continue;
            await fs.mkdir(path.dirname(resolved), { recursive: true });
            await fs.writeFile(resolved, e.getData());
        }

        const manifestPath = path.join(extractDir, "theme.json");
        // One read answers both "is it there" and "what does it say".
        let manifestRaw: string;
        try {
            manifestRaw = await fs.readFile(manifestPath, "utf-8");
        } catch {
            return NextResponse.json({ error: "theme.json missing" }, { status: 400 });
        }
        let raw: unknown;
        try { raw = JSON.parse(manifestRaw); }
        catch { return NextResponse.json({ error: "theme.json invalid JSON" }, { status: 400 }); }

        const parsed = themeManifestSchema.safeParse(raw);
        if (!parsed.success) {
            // Rollback extracted dir if applicable (preserve existing rollback logic).
            const first = parsed.error.issues[0];
            const hint = first.path[0] === "schemaVersion"
                ? " (this theme is v1 - upgrade its manifest to schemaVersion 2)"
                : "";
            return NextResponse.json(
                { error: `Invalid theme.json: ${first.path.join(".")} - ${first.message}${hint}` },
                { status: 400 },
            );
        }
        const manifest = parsed.data;
        if (RESERVED_IDS.has(manifest.id)) return NextResponse.json({ error: "Theme id is reserved" }, { status: 400 });

        const target = path.join(THEMES_DIR, manifest.id);
        const targetResolved = path.resolve(target);
        if (!targetResolved.startsWith(path.resolve(THEMES_DIR) + path.sep)) {
            return NextResponse.json({ error: "Invalid theme path" }, { status: 400 });
        }
        const exists = await fs.access(target).then(() => true).catch(() => false);
        if (exists) await fs.rm(target, { recursive: true, force: true });
        await fs.cp(extractDir, target, { recursive: true });

        try {
            execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-theme-registry.ts"]), { cwd: PROJECT_ROOT, timeout: 30_000, stdio: "pipe" });
        } catch (e) {
            await fs.rm(target, { recursive: true, force: true });
            return NextResponse.json({ error: "Theme failed regeneration", details: devOnlyDetail(e) }, { status: 400 });
        }

        // Filesystem + codegen is the source of truth - no DB row needed.
        // manifestHash is kept for audit logging if needed in future.
        void manifestHash(manifest);

        return NextResponse.json({ ok: true, id: manifest.id });
    } catch (err) {
        return NextResponse.json({ error: "Upload failed", details: devOnlyDetail(err) }, { status: 500 });
    } finally {
        if (extractDir) await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
}
