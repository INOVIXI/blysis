import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import AdmZip from "adm-zip";
import { invalidateModuleCache } from "@/core/lib/module-cache";
import { acquireInstallLock, scheduleBuild } from "@/core/lib/install-lock";
import { moduleMarketplaceBase } from "@/core/lib/marketplace-source";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { checkManifestFileRefs } from "@/core/lib/module-ref-resolver";
import { validateZipEntries } from "@/core/lib/module-zip-validator";
import { MODULES_DIR } from "@/core/lib/runtime-paths";
import { resolveInstallPlan, installPlanErrorMessage, type CatalogEntry } from "@/core/lib/install-plan";
import { loadMarketplaceCatalog } from "../_catalog";
import moduleSystem from "@/core/lib/modules";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";
import { toolCommand } from "@/core/lib/tool-command";

/**
 * The ticked modules. Only `id` is read; the catalogue supplies everything
 * else, so extra fields are ignored rather than refused.
 */
const bulkInstallSchema = z.object({
    modules: z.array(z.object({ id: z.string().max(64) })).min(1).max(50),
});

const MAX_MODULE_SIZE = 50 * 1024 * 1024;
const RESERVED_IDS = ["auth", "admin", "core", "api", "users", "roles", "settings", "profile", "modules", "themes"];

interface RequestedModule {
    id: string;
    zip: string;
    name: string;
}

/**
 * Expands the ticked modules into a complete, ordered install list.
 *
 * The first-run wizard has always run every selection through
 * `resolveInstallPlan`, on the client to show the operator what a tick pulls in
 * and again on the server so the answer is not the client's to decide. The
 * admin marketplace never did either, so ticking Leaderboard without ticking
 * Store installed Leaderboard alone - and `leaderboard/api/route.ts` calls
 * `prisma.order`, a model only Store's schema defines. The merged schema came
 * out without it, the rebuild bulk install schedules failed, and the site sat
 * on its last good build.
 *
 * Already-installed modules join the catalog so an existing dependency
 * satisfies the plan instead of being reported missing, and so a module
 * uploaded by hand rather than taken from the marketplace still counts.
 */
async function planBulkInstall(
    requestedIds: readonly string[],
): Promise<
    | { ok: false; error: string }
    | { ok: true; order: RequestedModule[]; autoAdded: string[] }
> {
    let index;
    try {
        index = await loadMarketplaceCatalog();
    } catch {
        return { ok: false, error: "Could not read the module marketplace catalog." };
    }

    const catalog: CatalogEntry[] = index.modules.map((m) => ({
        id: m.id,
        version: m.version,
        dependencies: m.dependencies ?? [],
        conflicts: m.conflicts ?? [],
        ...(m.coreVersion ? { coreVersion: m.coreVersion } : {}),
    }));
    const known = new Set(catalog.map((e) => e.id));
    for (const def of moduleSystem.getDefinitions()) {
        if (known.has(def.id)) continue;
        catalog.push({
            id: def.id,
            version: def.version ?? "0.0.0",
            dependencies: def.dependencies ?? [],
            conflicts: def.conflicts ?? [],
        });
    }

    const plan = resolveInstallPlan(requestedIds, catalog);
    if (plan.errors.length > 0) {
        return { ok: false, error: plan.errors.map(installPlanErrorMessage).join("; ") };
    }

    // The zip a module ships as is the catalog's to say, not the caller's.
    const byId = new Map(index.modules.map((m) => [m.id, m]));
    const order: RequestedModule[] = [];
    for (const id of plan.order) {
        const entry = byId.get(id);
        // Not in the marketplace means it is already on disk: nothing to fetch.
        if (!entry) continue;
        order.push({ id, zip: entry.zip, name: entry.name });
    }

    return { ok: true, order, autoAdded: plan.autoAdded };
}

interface BulkResult {
    id: string;
    name: string;
    status: "installed" | "failed" | "skipped";
    error?: string;
}

/**
 * POST /api/v1/modules/marketplace/bulk-install
 * Install multiple modules in one request.
 * Runs schema merge, registry gen, build, and restart ONCE at the end.
 */
export async function POST(request: NextRequest) {
    await ensureHooks();
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const releaseLock = await acquireInstallLock();
    if (!releaseLock) {
        return NextResponse.json({ error: "Another install is in progress. Please try again." }, { status: 429 });
    }

    try {
    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = bulkInstallSchema.safeParse(jsonBody);
    if (!parsed.success) {
        // Which of the two refusals it is comes from the issue itself rather
        // than from re-reading the body: a `too_big` on `modules` is the cap,
        // anything else is a malformed list.
        const tooMany = parsed.error.issues.some(
            (issue) => issue.code === "too_big" && issue.path[0] === "modules",
        );
        return NextResponse.json(
            { error: tooMany ? "Max 50 modules per bulk install" : "modules array required" },
            { status: 400 },
        );
    }
    const { modules } = parsed.data;

    const requestedIds: string[] = [];
    for (const mod of modules) {
        const id = mod.id;
        if (!/^[a-z0-9-]+$/.test(id)) {
            return NextResponse.json({ error: "Invalid module ID" }, { status: 400 });
        }
        if (RESERVED_IDS.includes(id)) {
            return NextResponse.json({ error: `Module ID '${id}' is reserved` }, { status: 400 });
        }
        requestedIds.push(id);
    }

    const plan = await planBulkInstall(requestedIds);
    if (!plan.ok) {
        return NextResponse.json({ error: plan.error }, { status: 400 });
    }

    const results: BulkResult[] = [];
    let hasSchemaChanges = false;

    // Phase 1: Download and extract all modules, dependencies first.
    for (const mod of plan.order) {
        const { id, zip, name } = mod;

        const targetDir = path.join(MODULES_DIR, id);
        const exists = await fs.access(targetDir).then(() => true).catch(() => false);
        if (exists) { results.push({ id, name: name || id, status: "skipped", error: "Already installed" }); continue; }

        try {
            const res = await fetch(`${moduleMarketplaceBase()}/${zip}`);
            if (!res.ok) { results.push({ id, name: name || id, status: "failed", error: `Download failed: ${res.status}` }); continue; }

            // What the server says it is sending, before the body is read.
            // The single-module install route has always checked this; here a
            // list of fifty ids meant fifty full downloads buffered in turn,
            // each measured only after it was already in memory.
            const declared = res.headers.get("content-length");
            if (declared && parseInt(declared, 10) > MAX_MODULE_SIZE) {
                results.push({ id, name: name || id, status: "failed", error: "Too large" });
                continue;
            }

            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length > MAX_MODULE_SIZE) { results.push({ id, name: name || id, status: "failed", error: "Too large" }); continue; }
            if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) { results.push({ id, name: name || id, status: "failed", error: "Invalid ZIP" }); continue; }

            const zipFile = new AdmZip(buffer);
            const contentCheck = validateZipEntries(zipFile.getEntries());
            if (!contentCheck.ok) {
                results.push({ id, name: name || id, status: "failed", error: contentCheck.error ?? "ZIP validation failed" });
                continue;
            }

            await fs.mkdir(targetDir, { recursive: true });
            for (const entry of zipFile.getEntries()) {
                if (entry.isDirectory || entry.entryName.includes("../")) continue;
                const resolvedPath = path.resolve(targetDir, entry.entryName);
                if (!resolvedPath.startsWith(path.resolve(targetDir) + path.sep)) continue;
                await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
                await fs.writeFile(resolvedPath, entry.getData());
            }

            // Verify module.json
            // Read rather than asked about: checking a path exists and then
            // opening it leaves a window between the two, and the read is the
            // answer to both questions at once.
            const manifestPath = path.join(targetDir, "module.json");
            let manifestText: string;
            try {
                manifestText = await fs.readFile(manifestPath, "utf-8");
            } catch {
                await fs.rm(targetDir, { recursive: true, force: true });
                results.push({ id, name: name || id, status: "failed", error: "No module.json" });
                continue;
            }

            // Until this ran, bulk install was the one path into src/modules/
            // that accepted a manifest without validating it: no schema parse,
            // no file-ref check, no reserved-id check. Installing the same
            // module one at a time went through all three. Two doors into the
            // same directory with different locks is not a design.
            const parsedManifest = moduleManifestSchema.safeParse(JSON.parse(manifestText));
            if (!parsedManifest.success) {
                await fs.rm(targetDir, { recursive: true, force: true });
                const first = parsedManifest.error.issues[0];
                results.push({
                    id,
                    name: name || id,
                    status: "failed",
                    error: `Invalid manifest: ${first ? `${first.path.join(".")}: ${first.message}` : "does not match schema"}`.slice(0, 100),
                });
                continue;
            }
            const manifest = parsedManifest.data;

            if (manifest.id !== id) {
                await fs.rm(targetDir, { recursive: true, force: true });
                results.push({ id, name: name || id, status: "failed", error: `Manifest id is ${manifest.id}` });
                continue;
            }

            const refCheck = checkManifestFileRefs(targetDir, manifest);
            const badRefs = [...refCheck.escaping, ...refCheck.missing];
            if (badRefs.length > 0) {
                await fs.rm(targetDir, { recursive: true, force: true });
                results.push({
                    id,
                    name: name || id,
                    status: "failed",
                    error: `Manifest references missing files: ${badRefs.slice(0, 3).join(", ")}`.slice(0, 100),
                });
                continue;
            }

            const hasSchema = await fs.access(path.join(targetDir, "schema.prisma")).then(() => true).catch(() => false);
            if (hasSchema) hasSchemaChanges = true;

            // Seed the module's strings the way the single install does.
            // This used to call a local `mergeTranslations` that wrote JSON
            // into a `messages/` directory at the project root. That
            // directory does not exist - core keeps its catalogue in
            // `messages-core/` and everything else in the Translation table -
            // so every write threw ENOENT into a `catch { /* skip */ }` and a
            // bulk-installed module arrived with no strings at all, rendering
            // raw keys on every one of its pages. Installing the same module
            // one at a time worked, because that path always used the table.
            if (manifest.translations) {
                const { syncModuleTranslations } = await import("@/core/lib/i18n/translation-service");
                await syncModuleTranslations(
                    id,
                    manifest.translations as Record<string, Record<string, unknown>>,
                );
            }

            // Create DB record
            await prisma.moduleConfig.upsert({
                where: { id },
                update: { name: manifest.name, enabled: true },
                create: { id, name: manifest.name, enabled: true },
            });

            const { doActionAsync, HookNames } = await import("@/core/lib/hooks");
            await doActionAsync(HookNames.MODULE_INSTALLED, { moduleId: id });

            results.push({ id, name: manifest.name, status: "installed" });
        } catch (err) {
            await fs.rm(path.join(MODULES_DIR, id), { recursive: true, force: true }).catch(() => {});
            results.push({ id, name: name || id, status: "failed", error: (err as Error).message.slice(0, 100) });
        }
    }

    // Phase 2: Single schema merge + registry gen + build + restart
    const installed = results.filter(r => r.status === "installed");
    if (installed.length > 0) {
        await invalidateModuleCache();

        // Schema merge + DB push
        if (hasSchemaChanges) {
            try {
                execFileSync(...toolCommand(["npx", "tsx", "scripts/merge-schemas.ts"]), { cwd: process.cwd(), timeout: 60000, stdio: "pipe" });
                // Not `prisma db push`, which is what this used to run: it
                // reconciles the whole database to the merged schema, and
                // uninstall deliberately leaves a module's tables behind, so
                // after any uninstall push either drops them silently or
                // refuses to run at all. This applies only the additive half
                // of the same diff.
                execFileSync(...toolCommand(["npx", "tsx", "scripts/apply-schema-additions.ts"]), { cwd: process.cwd(), timeout: 120000, stdio: "pipe" });
            } catch { /* will need manual: npm run db:merge && npm run db:push */ }
        }

        // Registry generation
        try {
            execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-registry.ts"]), { cwd: process.cwd(), timeout: 30000, stdio: "pipe" });
        } catch { /* will need manual: npx tsx scripts/generate-registry.ts */ }

        // Single deferred build + restart for the whole batch. scheduleBuild
        // is a no-op outside production and debounces, so 37 modules still
        // produce exactly one build.
        scheduleBuild();
    }

    return NextResponse.json({
        // The plan, not the request: a dependency the operator did not tick is
        // still a module that got installed, and the UI has to be able to say so.
        total: plan.order.length,
        autoAdded: plan.autoAdded,
        installed: installed.length,
        failed: results.filter(r => r.status === "failed").length,
        skipped: results.filter(r => r.status === "skipped").length,
        results,
    });
    } finally {
        releaseLock();
    }
}
