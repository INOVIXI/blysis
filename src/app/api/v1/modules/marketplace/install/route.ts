import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import AdmZip from "adm-zip";
import { findApiPathConflicts } from "@/core/lib/module-api-conflicts";
import { invalidateModuleCache } from "@/core/lib/module-cache";
import { acquireInstallLock, scheduleBuild } from "@/core/lib/install-lock";
import { logActivity } from "@/core/lib/activity-log";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { checkManifestFileRefs } from "@/core/lib/module-ref-resolver";
import { validateZipEntries } from "@/core/lib/module-zip-validator";
import { backupBeforeModuleChange } from "@/core/lib/module-backup";
import { manifestHash } from "@/core/lib/module-install-audit";
import { checkModuleDependencies, dependencyErrorMessage, installedVersionsFrom } from "@/core/lib/module-dependencies";
import moduleSystem from "@/core/lib/modules";
import { MODULES_DIR, PROJECT_ROOT, resolveWithin } from "@/core/lib/runtime-paths";
import { moduleMarketplaceBase } from "@/core/lib/marketplace-source";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";
import { devOnlyDetail } from "@/core/lib/api-utils";
import { log } from "@/core/lib/logger";
import { toolCommand } from "@/core/lib/tool-command";

/** Which catalogue module to fetch. The regex checks below still apply. */
const installModuleSchema = z.object({
    moduleId: z.string().max(64),
    zipFile: z.string().max(200),
});
const MAX_MODULE_SIZE = 50 * 1024 * 1024; // 50MB
const RESERVED_IDS = ["auth", "admin", "core", "api", "users", "roles", "settings", "profile", "modules", "themes"];

// POST /api/v1/modules/marketplace/install - Install a module from marketplace
export async function POST(request: NextRequest) {
    await ensureHooks();
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const releaseLock = await acquireInstallLock();
    if (!releaseLock) {
        return NextResponse.json({ error: "Another install is in progress. Please try again." }, { status: 429 });
    }

    // Track whether we extracted files so the outer catch can roll back.
    // Without this, an exception anywhere after extraction leaves orphaned
    // module files on disk that get picked up by the next filesystem scan.
    let extractedPath: string | null = null;

    try {
        const jsonBody = await readJsonBody(request);
        if (jsonBody instanceof NextResponse) return jsonBody;
        const parsedBody = installModuleSchema.safeParse(jsonBody);
        const { moduleId, zipFile } = parsedBody.success ? parsedBody.data : { moduleId: "", zipFile: "" };
        if (!moduleId || !zipFile) {
            return NextResponse.json({ error: "moduleId and zipFile required" }, { status: 400 });
        }

        // Validate format BEFORE using moduleId in path.join - without
        // this, a value like "../../../tmp/x" would let a crafted ZIP whose
        // manifest declared the same id break out of MODULES_DIR. Every
        // other module route enforces /^[a-z0-9-]+$/; the marketplace
        // install path was the only one missing the check.
        if (typeof moduleId !== "string" || !/^[a-z0-9-]+$/.test(moduleId)) {
            return NextResponse.json({ error: "Invalid module ID" }, { status: 400 });
        }

        // Validate zipFile to prevent SSRF / path traversal
        if (!/^[a-z0-9-]+\.zip$/.test(zipFile)) {
            return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
        }

        if (RESERVED_IDS.includes(moduleId)) {
            return NextResponse.json({ error: "Module ID is reserved" }, { status: 400 });
        }

        // Check if already installed
        const targetDir = resolveWithin(MODULES_DIR, moduleId);
        if (!targetDir) {
            return NextResponse.json({ error: "Invalid module ID" }, { status: 400 });
        }
        const exists = await fs.access(targetDir).then(() => true).catch(() => false);
        if (exists) {
            return NextResponse.json({ error: "Module already installed" }, { status: 409 });
        }

        // Opt-in pre-install DB snapshot. Modules can ship schema.prisma
        // fragments that merge into the core schema, and a half-applied
        // migration is the single most common "why is production broken"
        // scenario. Snapshot fails silently when pg_dump isn't available
        // (dev boxes, minimal Docker images) - the install still proceeds.
        await backupBeforeModuleChange("install", moduleId);

        // Check available disk space (need at least 100MB free)
        try {
            const stats = await fs.statfs(MODULES_DIR);
            const freeBytes = stats.bsize * stats.bfree;
            if (freeBytes < 100 * 1024 * 1024) {
                return NextResponse.json({ error: "Insufficient disk space" }, { status: 507 });
            }
        } catch { /* statfs not available on all platforms */ }

        // Download ZIP from GitHub with size limit
        const zipUrl = `${moduleMarketplaceBase()}/${zipFile}`;
        const res = await fetch(zipUrl);
        if (!res.ok) {
            return NextResponse.json({ error: `Failed to download module: HTTP ${res.status}` }, { status: 502 });
        }

        const contentLength = res.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_MODULE_SIZE) {
            return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 });
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > MAX_MODULE_SIZE) {
            return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 });
        }

        // Validate ZIP magic number
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
            return NextResponse.json({ error: "Invalid ZIP file" }, { status: 400 });
        }

        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();

        const contentCheck = validateZipEntries(entries);
        if (!contentCheck.ok) {
            return NextResponse.json({ error: contentCheck.error ?? "ZIP validation failed" }, { status: 400 });
        }

        // Extract to module directory
        await fs.mkdir(targetDir, { recursive: true });
        extractedPath = targetDir;
        const targetRoot = path.resolve(targetDir);
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const resolvedPath = path.resolve(targetDir, entry.entryName);
            if (!resolvedPath.startsWith(targetRoot + path.sep)) continue;
            await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
            await fs.writeFile(resolvedPath, entry.getData());
        }

        // Read the manifest. One read answers both "is it there" and "what
        // does it say"; asking first and reading second leaves a gap the file
        // can change in.
        const manifestPath = path.join(targetDir, "module.json");
        let manifestRaw: string;
        try {
            manifestRaw = await fs.readFile(manifestPath, "utf-8");
        } catch {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json({ error: "Invalid module - no module.json found" }, { status: 400 });
        }

        // Parse + validate manifest with Zod
        let manifestJson: unknown;
        try {
            manifestJson = JSON.parse(manifestRaw);
        } catch {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json({ error: "Invalid module.json - not valid JSON" }, { status: 400 });
        }

        const parsed = moduleManifestSchema.safeParse(manifestJson);
        if (!parsed.success) {
            await fs.rm(targetDir, { recursive: true, force: true });
            const first = parsed.error.issues[0];
            const where = first.path.join(".");
            return NextResponse.json(
                { error: `Invalid module.json: ${where ? where + " - " : ""}${first.message}` },
                { status: 400 },
            );
        }
        const manifestData = parsed.data;

        if (manifestData.id !== moduleId) {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json({ error: `Manifest ID '${manifestData.id}' does not match requested module '${moduleId}'` }, { status: 400 });
        }

        // Refuse install when declared dependencies are missing/disabled or
        // a declared conflict is currently active. Runs BEFORE the registry
        // regen so a mis-installed module can't drag half-initialized state
        // into the runtime registry.
        const depCheck = await checkModuleDependencies(manifestData, {
            installedVersions: installedVersionsFrom(moduleSystem.getDefinitions()),
        });
        if (!depCheck.ok) {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json(
                {
                    error: `Module ${moduleId} ${dependencyErrorMessage(depCheck)}`,
                    missingDependencies: depCheck.missingDependencies,
                    disabledDependencies: depCheck.disabledDependencies,
                    activeConflicts: depCheck.activeConflicts,
                    versionMismatches: depCheck.versionMismatches,
                    coreIncompatible: depCheck.coreIncompatible,
                },
                { status: 409 },
            );
        }


        // Which module answers an address is decided by enumeration order:
        // `matchApiRoute` takes the first declaration whose path equals the
        // URL. A manifest arrives from outside, so without this check a new
        // module could claim a path that has been answering for months and
        // make it unreachable with nothing said. Runs before the registry
        // regen, like the dependency check above.
        const addressClash = findApiPathConflicts(
            { module: manifestData.id, paths: (manifestData.api ?? []).map((entry) => entry.path) },
            moduleSystem.getDefinitions().map((installed) => ({
                module: installed.id,
                paths: (installed.api ?? []).map((entry) => entry.path),
            })),
        );
        if (addressClash.length > 0) {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json(
                {
                    error: `Module ${manifestData.id} claims API paths another module already answers`,
                    conflictingPaths: addressClash,
                },
                { status: 409 },
            );
        }

        const refCheck = checkManifestFileRefs(targetDir, manifestData);
        if (refCheck.escaping.length > 0) {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json(
                { error: `Manifest references escape module root: ${refCheck.escaping.slice(0, 5).join(", ")}` },
                { status: 400 },
            );
        }
        if (refCheck.missing.length > 0) {
            await fs.rm(targetDir, { recursive: true, force: true });
            return NextResponse.json(
                { error: `Manifest references missing files: ${refCheck.missing.slice(0, 5).join(", ")}` },
                { status: 400 },
            );
        }

        // Schema merge (sync, lightweight - just merges files)
        const schemaPath = path.join(targetDir, "schema.prisma");
        const hasSchema = await fs.access(schemaPath).then(() => true).catch(() => false);
        if (hasSchema) {
            try {
                execFileSync(...toolCommand(["npx", "tsx", "scripts/merge-schemas.ts"]), { cwd: PROJECT_ROOT, timeout: 30000, stdio: "pipe" });
            } catch {
                // Non-fatal: schema will be merged during deferred build
            }
        }

        // Registry generation (sync, lightweight). This MUST succeed - the
        // proxy gates module routes on the generated route-map, so a stale
        // registry makes a freshly-installed module's pages 404. The
        // deferred build will regenerate it too, but that can't be the
        // primary contract: we'd return 200 to the admin while the module
        // is silently invisible for minutes. Hard-fail + roll back the
        // extracted files if it can't generate.
        try {
            execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-registry.ts"]), { cwd: PROJECT_ROOT, timeout: 30000, stdio: "pipe" });
        } catch (err) {
            await fs.rm(targetDir, { recursive: true, force: true });
            extractedPath = null;
            log.error("[modules] registry generation failed, install rolled back", {
                error: err instanceof Error ? err.message : String(err),
            });
            return NextResponse.json(
                {
                    error: "Registry generation failed - install rolled back",
                    details: devOnlyDetail(err),
                },
                { status: 500 },
            );
        }

        // Create DB record
        const manifest = manifestData;
        const installedAt = new Date();
        const hash = manifestHash(manifest);
        await prisma.moduleConfig.upsert({
            where: { id: moduleId },
            update: {
                name: manifest.name,
                enabled: true,
                manifestHash: hash,
                installedAt,
                installedByUserId: session.user.id,
            },
            create: {
                id: moduleId,
                name: manifest.name,
                enabled: true,
                manifestHash: hash,
                installedAt,
                installedByUserId: session.user.id,
            },
        });
        await invalidateModuleCache();

        // Sync translations to DB (instant, no rebuild needed)
        if (manifest.translations) {
            const { syncModuleTranslations } = await import("@/core/lib/i18n/translation-service");
            await syncModuleTranslations(moduleId, manifest.translations);
        }

        // Schedule deferred build + restart (debounced - waits for more installs)
        // Bulk install: 37 modules call this, but only ONE build runs after all finish
        scheduleBuild();

        // HookNames.MODULE_INSTALLED is part of the published contract, so it has to
        // actually fire - a declared hook nobody emits is a listener that never
        // runs, with nothing to show for it in any log.
        const { doActionAsync, HookNames } = await import("@/core/lib/hooks");
        await doActionAsync(HookNames.MODULE_INSTALLED, { moduleId });

        logActivity({
            userId: session.user.id,
            action: "module.install",
            entity: "module",
            entityId: moduleId,
            metadata: { name: manifest.name, version: manifest.version },
        }).catch(() => {});

        return NextResponse.json({
            message: "Module installed and enabled",
            module: { id: moduleId, name: manifest.name, version: manifest.version, enabled: true },
            buildScheduled: true,
        });
    } catch (err: unknown) {
        // Install failed after extraction - remove the orphan directory so
        // the next filesystem scan doesn't discover a half-installed module
        // that has no matching DB row.
        if (extractedPath) {
            await fs.rm(extractedPath, { recursive: true, force: true }).catch(() => { /* best-effort */ });
        }
        log.error("[modules] installing from the marketplace failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json(
            { error: "Operation failed", details: devOnlyDetail(err) },
            { status: 500 },
        );
    } finally {
        releaseLock();
    }
}

