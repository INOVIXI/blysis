import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import { acquireInstallLock, scheduleBuild } from "@/core/lib/install-lock";
import AdmZip from "adm-zip";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { checkManifestFileRefs } from "@/core/lib/module-ref-resolver";
import { validateZipEntries } from "@/core/lib/module-zip-validator";
import {
    checkModuleDependencies,
    dependencyErrorMessage,
    installedVersionsFrom,
    parseDependency,
} from "@/core/lib/module-dependencies";
import { satisfiesRange } from "@/core/lib/semver-range";
import moduleSystem from "@/core/lib/modules";
import { backupBeforeModuleChange } from "@/core/lib/module-backup";
import { manifestHash } from "@/core/lib/module-install-audit";
import { MODULES_DIR, TMP_DIR, PROJECT_ROOT, resolveWithin } from "@/core/lib/runtime-paths";
import { moduleMarketplaceBase } from "@/core/lib/marketplace-source";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";
import { devOnlyDetail } from "@/core/lib/api-utils";
import { log } from "@/core/lib/logger";
import { toolCommand } from "@/core/lib/tool-command";

/** Which catalogue module to fetch. The regex checks below still apply. */
const updateModuleSchema = z.object({
    moduleId: z.string().max(64),
    zipFile: z.string().max(200),
});

const MAX_MODULE_SIZE = 50 * 1024 * 1024;

// POST /api/v1/modules/update - Update an installed module from marketplace
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Install, bulk install and uninstall all serialize on this lock, and the
    // uninstall route's own comment said update did too. It did not. An update
    // stages the new files and then swaps them into src/modules/<id> while a
    // concurrent uninstall is running `fs.rm` over the same directory, so the
    // module could end up half replaced - or present with no module.json,
    // which fails registry generation and takes the next build with it.
    const releaseLock = await acquireInstallLock();
    if (!releaseLock) {
        return NextResponse.json(
            { error: "Another module operation is in progress. Please try again." },
            { status: 429 },
        );
    }

    try {
        const jsonBody = await readJsonBody(request);
        if (jsonBody instanceof NextResponse) return jsonBody;
        const parsed = updateModuleSchema.safeParse(jsonBody);
        const { moduleId, zipFile } = parsed.success ? parsed.data : { moduleId: "", zipFile: "" };
        if (!moduleId || !zipFile) {
            return NextResponse.json({ error: "moduleId and zipFile required" }, { status: 400 });
        }

        if (!/^[a-z0-9-]+$/.test(moduleId)) {
            return NextResponse.json({ error: "Invalid module ID" }, { status: 400 });
        }
        if (!/^[a-z0-9-]+\.zip$/.test(zipFile)) {
            return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
        }

        const targetDir = resolveWithin(MODULES_DIR, moduleId);
        if (!targetDir) {
            return NextResponse.json({ error: "Invalid module target path" }, { status: 400 });
        }

        const exists = await fs.access(targetDir).then(() => true).catch(() => false);
        if (!exists) {
            return NextResponse.json({ error: "Module not installed - use install instead" }, { status: 404 });
        }

        // Opt-in pre-update DB snapshot (MODULE_INSTALL_BACKUP=1). Module
        // updates can ship schema changes; a snapshot gives ops a point
        // to roll back to when a migration half-applies.
        await backupBeforeModuleChange("update", moduleId);

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
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
            return NextResponse.json({ error: "Invalid ZIP file" }, { status: 400 });
        }

        let zip: AdmZip;
        let entries: AdmZip.IZipEntry[];
        try {
            zip = new AdmZip(buffer);
            entries = zip.getEntries();
        } catch {
            return NextResponse.json({ error: "Invalid or corrupt ZIP" }, { status: 400 });
        }

        const contentCheck = validateZipEntries(entries);
        if (!contentCheck.ok) {
            return NextResponse.json({ error: contentCheck.error ?? "ZIP validation failed" }, { status: 400 });
        }

        // Stage the update in a temp dir first, validate, then swap.
        const tmpDir = TMP_DIR;
        await fs.mkdir(tmpDir, { recursive: true });
        const stageDir = resolveWithin(tmpDir, `module-stage-${moduleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        const backupDir = resolveWithin(tmpDir, `backup-${moduleId}-${Date.now()}`);
        if (!stageDir || !backupDir) {
            return NextResponse.json({ error: "Invalid module ID" }, { status: 400 });
        }
        await fs.mkdir(stageDir, { recursive: true });
        const stageRoot = path.resolve(stageDir);


        try {
            for (const entry of entries) {
                if (entry.isDirectory) continue;
                const resolvedPath = path.resolve(stageDir, entry.entryName);
                if (!resolvedPath.startsWith(stageRoot + path.sep)) continue;
                await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
                await fs.writeFile(resolvedPath, entry.getData());
            }

            // One read answers both "is it there" and "what does it say".
            const manifestPath = path.join(stageDir, "module.json");
            let manifestRaw: string;
            try {
                manifestRaw = await fs.readFile(manifestPath, "utf-8");
            } catch {
                return NextResponse.json({ error: "Invalid module update - no module.json found" }, { status: 400 });
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

            if (manifest.id !== moduleId) {
                return NextResponse.json(
                    { error: `Manifest ID '${manifest.id}' does not match requested module '${moduleId}'` },
                    { status: 400 },
                );
            }

            // Forward: does the incoming version still fit this deployment?
            const depCheck = await checkModuleDependencies(manifest, {
                installedVersions: installedVersionsFrom(moduleSystem.getDefinitions()),
            });
            if (!depCheck.ok) {
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

            // Reverse: an update is the one operation that can silently break
            // a *different* module. Anything enabled that pins a range on this
            // module gets its range re-checked against the incoming version
            // before a single file is replaced.
            const enabledIds = new Set(
                (await prisma.moduleConfig.findMany({ where: { enabled: true }, select: { id: true } }))
                    .map((r) => r.id),
            );
            const brokenDependents: Array<{ id: string; required: string }> = [];
            for (const def of moduleSystem.getDefinitions()) {
                if (def.id === moduleId || !enabledIds.has(def.id)) continue;
                for (const spec of def.dependencies ?? []) {
                    const dep = parseDependency(spec);
                    if (dep.id !== moduleId || !dep.range) continue;
                    if (!satisfiesRange(manifest.version, dep.range)) {
                        brokenDependents.push({ id: def.id, required: dep.range });
                    }
                }
            }
            if (brokenDependents.length > 0) {
                return NextResponse.json(
                    {
                        error:
                            `Updating ${moduleId} to ${manifest.version} would break enabled modules: ` +
                            brokenDependents.map((d) => `${d.id} (requires ${d.required})`).join(", "),
                        brokenDependents,
                    },
                    { status: 409 },
                );
            }

            const refCheck = checkManifestFileRefs(stageDir, manifest);
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

            // Stage looks clean - back up current, swap in new
            await fs.cp(targetDir, backupDir, { recursive: true });
            await fs.rm(targetDir, { recursive: true, force: true });
            await fs.cp(stageDir, targetDir, { recursive: true });

            try {
                execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-registry.ts"]), {
                    cwd: PROJECT_ROOT,
                    timeout: 30000,
                    stdio: "pipe",
                });
            } catch (regErr: unknown) {
                // Registry failed - restore backup and re-run registry with old version
                await fs.rm(targetDir, { recursive: true, force: true });
                await fs.cp(backupDir, targetDir, { recursive: true });
                try {
                    execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-registry.ts"]), { cwd: PROJECT_ROOT, timeout: 30000, stdio: "pipe" });
                } catch { /* best effort */ }
                log.error("[modules] registry generation failed after update, backup restored", {
                    error: String((regErr as Error)?.message || regErr),
                });
                return NextResponse.json(
                    { error: "Registry generation failed", details: devOnlyDetail(regErr) },
                    { status: 400 },
                );
            }

            // Deferred + debounced build and process replacement. Building
            // inline blocked the HTTP thread for minutes and then restarted
            // via a pm2 binary the image does not contain.
            scheduleBuild();

            // Install, upload, bulk install and setup all seed the module's
            // strings into the Translation table; update did not, so a module
            // that gained a key in a new release kept rendering the set it
            // shipped with on the day it was first installed. The keys were
            // in the files and never in the database. `syncModuleTranslations`
            // refreshes the rows the operator has not customised, adds the
            // missing ones, and leaves `isCustom` rows alone, which is exactly
            // what an upgrade wants.
            if (manifest.translations) {
                const { syncModuleTranslations } = await import("@/core/lib/i18n/translation-service");
                await syncModuleTranslations(
                    moduleId,
                    manifest.translations as Record<string, Record<string, unknown>>,
                );
            }

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

            return NextResponse.json({
                message: "Module updated successfully",
                module: { id: moduleId, name: manifest.name, version: manifest.version, enabled: true },
            });
        } finally {
            await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
            await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
        }
    } catch (err: unknown) {
        log.error("[modules] updating a module failed", {
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
