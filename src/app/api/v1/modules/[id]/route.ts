import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import { logActivity } from "@/core/lib/activity-log";
import { acquireInstallLock, scheduleBuild } from "@/core/lib/install-lock";
import { invalidateModuleCache } from "@/core/lib/module-cache";
import { devOnlyDetail } from "@/core/lib/api-utils";
import { backupBeforeModuleChange } from "@/core/lib/module-backup";
import { MODULES_DIR, PROJECT_ROOT } from "@/core/lib/runtime-paths";
import { findDependents } from "@/core/lib/module-dependencies";
import moduleSystem from "@/core/lib/modules";
import { invalidate } from "@/core/lib/cache";
import { log } from "@/core/lib/logger";
import { toolCommand } from "@/core/lib/tool-command";

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    await ensureHooks();
    const { id: moduleId } = await params;

    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (!/^[a-z0-9-]+$/.test(moduleId)) {
        return NextResponse.json({ error: "Invalid module ID" }, { status: 400 });
    }

    // Serialize module mutations through the same lock install/update use so
    // a concurrent install of the same module can't race a delete.
    const releaseLock = await acquireInstallLock();
    if (!releaseLock) {
        return NextResponse.json(
            { error: "Another module operation is in progress. Please try again." },
            { status: 429 }
        );
    }

    try {
        const moduleDir = path.join(MODULES_DIR, moduleId);
        const resolvedDir = path.resolve(moduleDir);
        if (!resolvedDir.startsWith(path.resolve(MODULES_DIR) + path.sep)) {
            return NextResponse.json({ error: "Invalid module path" }, { status: 400 });
        }

        // Disabling refuses while an enabled module depends on this one.
        // Uninstalling is the more destructive half of the same operation and
        // had no such check, so removing `store` while `leaderboard` was
        // installed took `Order` out of the merged Prisma schema and left
        // `prisma.order` in leaderboard's code: the deferred rebuild then
        // failed and the site stayed on the last good build with no way
        // forward. Every module on disk counts here, enabled or not, because
        // the schema merge and the registry read the filesystem.
        const dependents = findDependents(moduleId, moduleSystem.getDefinitions());
        if (dependents.length > 0) {
            return NextResponse.json(
                {
                    error: `Cannot uninstall '${moduleId}': ${dependents.length === 1 ? `module '${dependents[0]}' depends` : `modules ${dependents.map((d) => `'${d}'`).join(", ")} depend`} on it. Uninstall ${dependents.length === 1 ? "it" : "them"} first.`,
                    dependents,
                },
                { status: 400 },
            );
        }

        const exists = await fs.access(moduleDir).then(() => true).catch(() => false);
        if (!exists) {
            // Even with no directory, clean up orphan DB rows - a previous
            // failed install may have left a ModuleConfig row behind.
            await prisma.moduleConfig.deleteMany({ where: { id: moduleId } }).catch(() => {});
            await invalidateModuleCache().catch(() => {});
            return NextResponse.json({ error: "Module not found on disk" }, { status: 404 });
        }

        // Opt-in pre-uninstall snapshot (MODULE_INSTALL_BACKUP=1). Even
        // though we preserve module-owned tables for reinstall, the
        // registry regen + build may still brick runtime state on a bad
        // module - a snapshot buys the operator a clean rollback.
        await backupBeforeModuleChange("uninstall", moduleId);

        await fs.rm(moduleDir, { recursive: true, force: true });

        // Module-owned tables (e.g. Store products when "store" is uninstalled)
        // are intentionally preserved so a future reinstall of the same module
        // does not lose the admin's data. Operators who want a true purge can
        // drop the module's tables via the schema merge + migration tooling.

        try {
            const { removeModuleTranslations } = await import("@/core/lib/i18n/translation-service");
            await removeModuleTranslations(moduleId);
        } catch { /* non-fatal */ }

        // Remove the DB config row BEFORE registry regeneration so the app
        // can never observe a state where the registry lists the module but
        // ModuleConfig says it should be disabled.
        await prisma.moduleConfig.deleteMany({ where: { id: moduleId } });

        // The scheduler keys a CronRun row per job as "<moduleId>:<jobId>",
        // and nothing was clearing them: a demo box had rows for three
        // modules that were no longer installed. They are inert while the
        // module is gone, since a tick only walks registered jobs, but a
        // reinstall inherits the old lastRunAt and a monthly job then sits
        // out the rest of its interval. Module-owned tables are preserved
        // for reinstall on purpose; a scheduling timestamp is not data the
        // admin put there.
        await prisma.cronRun
            .deleteMany({ where: { jobKey: { startsWith: `${moduleId}:` } } })
            .catch(() => {});

        // A module's own rows in the shared `Setting` table go with it. Every
        // module that writes settings tags them with its id on create, which
        // is what makes them findable; `validate-module` checks that it did.
        // Module-owned *tables* are preserved on purpose, because those hold
        // what the admin built - products, articles, tickets. A module's
        // settings are not that: they are credentials and endpoints for a
        // service the operator has just decided to stop using. An uninstalled
        // Cloudflare R2 left its access key and secret in the database with no
        // screen left in the admin panel to clear them, since the screen came
        // out with the module. Keys a module deliberately writes on core's
        // behalf, like `storage_active_provider`, are tagged `core` and stay;
        // storage already falls back to local when its provider is gone.
        await prisma.setting
            .deleteMany({ where: { module: moduleId } })
            .catch(() => {});
        await invalidate("public-settings").catch(() => {});
        await invalidateModuleCache().catch(() => {});

        let registryNeedsRebuild = false;
        try {
            // Synchronous: the generated registry must stop importing the
            // deleted module's files before anything else runs, or the next
            // build fails on a missing import.
            execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-registry.ts"]), { cwd: PROJECT_ROOT, timeout: 30000, stdio: "pipe" });
            // The rebuild + process replacement is deferred and debounced, so
            // this response returns now instead of after a 3-minute build the
            // admin's browser would have given up on.
            scheduleBuild();
        } catch (err) {
            // Registry/build failure is non-fatal for uninstall - the module
            // files are already gone and the DB row is cleared. But the
            // generated registry may still reference the deleted module's
            // imports, which would brick the next build. Log loudly and
            // surface the warning so the operator knows to rebuild manually.
            registryNeedsRebuild = true;
            log.error("[module:uninstall] registry regeneration failed", {
                moduleId,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // HookNames.MODULE_UNINSTALLED is part of the published contract, so it has to
        // actually fire - a declared hook nobody emits is a listener that never
        // runs, with nothing to show for it in any log.
        const { doActionAsync, HookNames } = await import("@/core/lib/hooks");
        await doActionAsync(HookNames.MODULE_UNINSTALLED, { moduleId });

        logActivity({
            action: "module.uninstall",
            entity: "module",
            entityId: moduleId,
            userId: session.user.id,
        }).catch(() => {});

        return NextResponse.json({
            message: "Module deleted successfully",
            ...(registryNeedsRebuild ? { warning: "Module files removed but registry regeneration failed - run `npm run build` to clean up generated imports." } : {}),
        });
    } catch (err: unknown) {
        return NextResponse.json(
            { error: "Delete failed", details: devOnlyDetail(err) },
            { status: 500 },
        );
    } finally {
        releaseLock();
    }
}
