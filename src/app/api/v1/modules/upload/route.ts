import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { rateLimit } from "@/core/lib/rate-limit";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import AdmZip from "adm-zip";
import { acquireInstallLock } from "@/core/lib/install-lock";
import { invalidateModuleCache } from "@/core/lib/module-cache";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { checkManifestFileRefs } from "@/core/lib/module-ref-resolver";
import { validateZipEntries } from "@/core/lib/module-zip-validator";
import { backupBeforeModuleChange } from "@/core/lib/module-backup";
import { manifestHash } from "@/core/lib/module-install-audit";
import { findApiPathConflicts } from "@/core/lib/module-api-conflicts";
import { checkModuleDependencies, dependencyErrorMessage, installedVersionsFrom } from "@/core/lib/module-dependencies";
import moduleSystem from "@/core/lib/modules";
import { MODULES_DIR, TMP_DIR, PROJECT_ROOT } from "@/core/lib/runtime-paths";
import { devOnlyDetail } from "@/core/lib/api-utils";
import { log } from "@/core/lib/logger";
import { toolCommand } from "@/core/lib/tool-command";
const RESERVED_IDS = new Set([
    "auth", "admin", "core", "api", "users", "roles", "settings", "profile", "modules", "themes",
]);

export async function POST(request: NextRequest) {
    await ensureHooks();
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rl = await rateLimit(`upload:${session.user.id}`, { maxRequests: 3, windowMs: 3600000 });
    if (!rl.success) {
        return NextResponse.json({ error: "Too many uploads. Try again later." }, { status: 429 });
    }

    const releaseLock = await acquireInstallLock();
    if (!releaseLock) {
        return NextResponse.json({ error: "Another install is in progress. Please try again." }, { status: 429 });
    }

    let extractDir: string | null = null;
    let createdTargetDir: string | null = null;

    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;
        if (!file || !file.name.endsWith(".zip")) {
            return NextResponse.json({ error: "Please upload a .zip file" }, { status: 400 });
        }

        const MAX_MODULE_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_MODULE_SIZE) {
            return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
            return NextResponse.json({ error: "Invalid ZIP file" }, { status: 400 });
        }

        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();

        const contentCheck = validateZipEntries(entries);
        if (!contentCheck.ok) {
            return NextResponse.json({ error: contentCheck.error ?? "ZIP validation failed" }, { status: 400 });
        }

        const tmpDir = TMP_DIR;
        await fs.mkdir(tmpDir, { recursive: true });
        extractDir = path.join(tmpDir, `module-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        await fs.mkdir(extractDir, { recursive: true });

        const extractRoot = path.resolve(extractDir);
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const resolvedPath = path.resolve(extractDir, entry.entryName);
            if (!resolvedPath.startsWith(extractRoot + path.sep)) continue;
            await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
            await fs.writeFile(resolvedPath, entry.getData());
        }

        let manifestDir = extractDir;
        const rootFiles = await fs.readdir(extractDir);

        if (!rootFiles.includes("module.json")) {
            const subdirs: string[] = [];
            for (const f of rootFiles) {
                const stat = await fs.stat(path.join(extractDir, f));
                if (stat.isDirectory()) subdirs.push(f);
            }
            if (subdirs.length === 1) {
                const subdir = path.join(extractDir, subdirs[0]);
                const subFiles = await fs.readdir(subdir);
                if (subFiles.includes("module.json")) {
                    manifestDir = subdir;
                }
            }
        }

        const manifestPath = path.join(manifestDir, "module.json");
        // Read it and let the read say whether it is there. Asking first and
        // reading second is two answers to one question, and the file can
        // change between them.
        let manifestRaw: string;
        try {
            manifestRaw = await fs.readFile(manifestPath, "utf-8");
        } catch {
            return NextResponse.json({ error: "No module.json found in ZIP" }, { status: 400 });
        }

        let manifestJson: unknown;
        try {
            manifestJson = JSON.parse(manifestRaw);
        } catch {
            return NextResponse.json({ error: "Invalid module.json - not valid JSON" }, { status: 400 });
        }

        const parsed = moduleManifestSchema.safeParse(manifestJson);
        if (!parsed.success) {
            const first = parsed.error.issues[0];
            const where = first.path.join(".");
            return NextResponse.json(
                { error: `Invalid module.json: ${where ? where + " - " : ""}${first.message}` },
                { status: 400 },
            );
        }
        const manifest = parsed.data;

        if (RESERVED_IDS.has(manifest.id)) {
            return NextResponse.json({ error: "Module ID is reserved" }, { status: 400 });
        }

        const depCheck = await checkModuleDependencies(manifest, {
            installedVersions: installedVersionsFrom(moduleSystem.getDefinitions()),
        });
        if (!depCheck.ok) {
            return NextResponse.json(
                {
                    error: `Module ${manifest.id} ${dependencyErrorMessage(depCheck)}`,
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
        // URL. An uploaded manifest is the least trusted input there is, so
        // without this check a ZIP could claim a path that has been answering
        // for months and make it unreachable with nothing said.
        const addressClash = findApiPathConflicts(
            { module: manifest.id, paths: (manifest.api ?? []).map((entry) => entry.path) },
            moduleSystem.getDefinitions().map((installed) => ({
                module: installed.id,
                paths: (installed.api ?? []).map((entry) => entry.path),
            })),
        );
        if (addressClash.length > 0) {
            return NextResponse.json(
                {
                    error: `Module ${manifest.id} claims API paths another module already answers`,
                    conflictingPaths: addressClash,
                },
                { status: 409 },
            );
        }

        const refCheck = checkManifestFileRefs(manifestDir, manifest);
        if (refCheck.escaping.length > 0) {
            return NextResponse.json(
                { error: `Manifest references escape module root: ${refCheck.escaping.slice(0, 5).join(", ")}` },
                { status: 400 },
            );
        }
        if (refCheck.missing.length > 0) {
            return NextResponse.json(
                { error: `Manifest references missing files: ${refCheck.missing.slice(0, 5).join(", ")}` },
                { status: 400 },
            );
        }

        const targetDir = path.join(MODULES_DIR, manifest.id);
        const targetResolved = path.resolve(targetDir);
        if (!targetResolved.startsWith(path.resolve(MODULES_DIR) + path.sep)) {
            return NextResponse.json({ error: "Invalid module target path" }, { status: 400 });
        }

        const exists = await fs.access(targetDir).then(() => true).catch(() => false);

        // Opt-in pre-install DB snapshot (MODULE_INSTALL_BACKUP=1). Runs
        // AFTER validation so a rejected upload never creates a backup
        // file, but BEFORE the file-system change so ops can roll back
        // the DB to its pre-upload state if a later migration explodes.
        await backupBeforeModuleChange(exists ? "update" : "install", manifest.id);

        if (exists) {
            await fs.rm(targetDir, { recursive: true, force: true });
        }

        await fs.cp(manifestDir, targetDir, { recursive: true });
        createdTargetDir = targetDir;

        try {
            execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-registry.ts"]), {
                cwd: PROJECT_ROOT,
                timeout: 30000,
                stdio: "pipe",
            });
        } catch (err: unknown) {
            await fs.rm(targetDir, { recursive: true, force: true });
            createdTargetDir = null;
            log.error("[modules] registry generation failed for an uploaded module", {
                error: err instanceof Error ? err.message : String(err),
            });
            return NextResponse.json(
                {
                    error: "Module has errors - registry generation failed",
                    details: devOnlyDetail(err),
                },
                { status: 400 },
            );
        }

        const installedAt = new Date();
        const hash = manifestHash(manifest);
        await prisma.moduleConfig.upsert({
            where: { id: manifest.id },
            update: {
                name: manifest.name,
                manifestHash: hash,
                installedAt,
                installedByUserId: session.user.id,
            },
            create: {
                id: manifest.id,
                name: manifest.name,
                enabled: false,
                manifestHash: hash,
                installedAt,
                installedByUserId: session.user.id,
            },
        });

        {
            const { doActionAsync, HookNames } = await import("@/core/lib/hooks");
            await doActionAsync(HookNames.MODULE_INSTALLED, { moduleId: manifest.id });
        }

        // Invalidate the module-state cache so the proxy and request handlers
        // see the freshly-installed module immediately. Without this, the
        // 30-second cache TTL leaves the new module's routes 404-ing until
        // the next refresh - surprising for a synchronous "install" response.
        await invalidateModuleCache().catch(() => {});

        // Sync the module's declared translations so admin/UI strings are
        // available right after install rather than after the next deferred
        // build cycle. Matches the marketplace install behavior.
        if (manifest.translations) {
            const { syncModuleTranslations } = await import("@/core/lib/i18n/translation-service");
            await syncModuleTranslations(manifest.id, manifest.translations as Record<string, Record<string, unknown>>).catch(() => {});
        }

        return NextResponse.json({
            message: "Module installed successfully",
            module: { id: manifest.id, name: manifest.name, version: manifest.version, enabled: false },
        });
    } catch (err: unknown) {
        if (createdTargetDir) {
            await fs.rm(createdTargetDir, { recursive: true, force: true }).catch(() => {});
        }
        log.error("[modules] installing an uploaded module failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json(
            { error: "Operation failed", details: devOnlyDetail(err) },
            { status: 500 },
        );
    } finally {
        if (extractDir) {
            await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
        }
        releaseLock();
    }
}
