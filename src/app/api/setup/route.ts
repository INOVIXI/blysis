import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import AdmZip from "adm-zip";
import { validateZipEntries } from "@/core/lib/module-zip-validator";
import prisma from "@/core/lib/db";
import { DEFAULT_ALGORITHM, hashPassword } from "@/core/lib/password-hash";
import { markSetupComplete } from "@/core/lib/setup-state";
import { invalidateModuleCache } from "@/core/lib/module-cache";
import { devOnlyDetail } from "@/core/lib/api-utils";
import {
    resolveInstallPlan,
    installPlanErrorMessage,
    type CatalogEntry,
} from "@/core/lib/module-dependencies";
import { MODULES_DIR } from "@/core/lib/runtime-paths";
import { manifestHash } from "@/core/lib/module-install-audit";
import { syncModuleTranslations } from "@/core/lib/i18n/translation-service";
import { readJsonBody } from "@/core/lib/api-body";
import { enforcePasswordPolicy } from "@/core/lib/security-settings";
import { log } from "@/core/lib/logger";
import { toolCommand } from "@/core/lib/tool-command";

/**
 * First-run setup API.
 *
 * Accepts a single POST payload containing the admin credentials, basic site
 * configuration, the selected theme, and any initial modules the installer
 * would like to enable. Every call re-verifies that `prisma.user.count() === 0`
 * so the endpoint cannot be replayed to create a second privileged account.
 *
 * @public-mutation: there is nobody to authenticate yet, which is what this
 * endpoint exists to fix. It closes itself instead: the first user row makes
 * every later call answer 409 before the body is read, and the account is
 * created inside an advisory-locked transaction so two racing installers
 * cannot both win.
 */

const setupSchema = z.object({
    admin: z.object({
        email: z.string().email(),
        username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
        // Length alone is checked by the shared policy below, which knows
        // the real minimum and the rest of the rules. Bounding it here only
        // keeps an absurd payload out of bcrypt.
        password: z.string().max(128),
    }),
    site: z.object({
        siteName: z.string().min(1).max(100),
        siteDescription: z.string().max(500).optional().default(""),
        defaultLocale: z.string().min(2).max(5),
    }),
    theme: z.string().min(1).max(50),
    // 50, not 20: the largest preset plus manual additions plus everything
    // those pull in transitively can exceed the old cap, and silently dropping
    // the tail produced a half-installed site.
    modules: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(50).default([]),
});

const MARKETPLACE_DIR = path.join(process.cwd(), "module-marketplace");
const MAX_MODULE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
    await ensureHooks();
    // Early rejection: if anyone already exists, reply without reading the
    // body. This is a fast path only - the real race protection is the
    // advisory-locked transaction below.
    let existingUsers = 0;
    try {
        existingUsers = await prisma.user.count();
    } catch (err) {
        return NextResponse.json(
            { error: "Database unreachable", details: devOnlyDetail(err) },
            { status: 500 }
        );
    }

    if (existingUsers > 0) {
        markSetupComplete();
        return NextResponse.json(
            { error: "Setup has already been completed." },
            { status: 409 }
        );
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid payload", issues: parsed.error.issues },
            { status: 400 }
        );
    }
    const data = parsed.data;

    // The first administrator is the most privileged account the site will
    // ever have, and it was the one account exempt from the site's own
    // password rules: the schema asked for eight characters where every other
    // flow asks for ten, an uppercase, a digit and a name that is not on the
    // common list.
    const policyCheck = await enforcePasswordPolicy(data.admin.password);
    if (!policyCheck.ok) {
        return NextResponse.json(
            { error: policyCheck.message ?? "Password does not meet the policy", code: policyCheck.reason },
            { status: 400 }
        );
    }

    // Hash the password outside the transaction - bcrypt is CPU-heavy and
    // the advisory-locked transaction below should hold the lock for as
    // little time as possible.
    const hashed = await hashPassword(data.admin.password, DEFAULT_ALGORITHM);

    // Stable integer key for pg_advisory_xact_lock. Any constant works as
    // long as nothing else in the app uses it for another purpose.
    const SETUP_LOCK_KEY = 738292847;

    let adminUser;
    let adminRoleId: string;
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Block any concurrent setup attempt on the same Postgres cluster
            // until this transaction commits or rolls back. The lock is
            // released automatically at transaction end.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;

            // Re-check inside the lock. Two requests that raced past the
            // early-path check outside both serialize here; the second one
            // sees count > 0 and aborts.
            const count = await tx.user.count();
            if (count > 0) {
                throw new Error("ALREADY_SETUP");
            }

            const adminRole = await tx.role.upsert({
                where: { name: "admin" },
                update: {},
                create: {
                    name: "admin",
                    displayName: "Administrator",
                    color: "#ef4444",
                    priority: 100,
                },
            });

            await tx.role.upsert({
                where: { name: "member" },
                update: {},
                create: {
                    name: "member",
                    displayName: "Member",
                    color: "#6b7280",
                    priority: 0,
                    isDefault: true,
                },
            });

            const admin = await tx.user.create({
                data: {
                    email: data.admin.email,
                    username: data.admin.username,
                    password: hashed,
                    roleId: adminRole.id,
                    emailVerified: new Date(),
                },
            });

            return { admin, adminRoleId: adminRole.id };
        });
        adminUser = result.admin;
        adminRoleId = result.adminRoleId;
    } catch (err) {
        if (err instanceof Error && err.message === "ALREADY_SETUP") {
            markSetupComplete();
            return NextResponse.json(
                { error: "Setup has already been completed." },
                { status: 409 }
            );
        }
        return NextResponse.json(
            { error: "Setup failed", details: devOnlyDetail(err) },
            { status: 500 },
        );
    }
    void adminRoleId;

    try {
        // ---------- Persist core settings ----------
        const settings: Array<{ key: string; value: unknown }> = [
            { key: "site_name", value: data.site.siteName },
            { key: "site_description", value: data.site.siteDescription || "" },
            { key: "default_locale", value: data.site.defaultLocale },
            { key: "active_theme", value: data.theme },
        ];
        for (const s of settings) {
            await prisma.setting.upsert({
                where: { key: s.key },
                update: { value: s.value as object },
                create: { key: s.key, value: s.value as object, module: "core" },
            });
        }

        // ---------- Plan the install ----------
        // The previous implementation installed the selection verbatim, in
        // whatever order it arrived. Picking `wheel` without `credits`, or
        // `store` without `currency`, therefore produced a module whose
        // prerequisites were simply absent. Planning first turns that into
        // either a corrected install or a clear refusal.
        const installedModules: string[] = [];
        const failedModules: Array<{ id: string; reason: string }> = [];
        let autoAdded: string[] = [];
        let registryNeedsRegen = false;

        if (data.modules.length > 0) {
            const plan = resolveInstallPlan(data.modules, await loadCatalog());

            if (plan.errors.length > 0) {
                // Refuse the module set rather than install part of it. The
                // admin account and settings above are already committed, so
                // the operator can re-run just the module step from the admin
                // panel - a half-installed site is the worse outcome.
                markSetupComplete();
                return NextResponse.json(
                    {
                        error: "The selected modules cannot be installed together.",
                        issues: plan.errors.map((e) => ({ ...e, message: installPlanErrorMessage(e) })),
                        adminCreated: true,
                    },
                    { status: 400 },
                );
            }

            autoAdded = plan.autoAdded;

            // plan.order is topological: a module is never extracted before
            // something it depends on.
            for (const moduleId of plan.order) {
                try {
                    const manifest = await installModuleFromLocalMarketplace(moduleId);
                    const hash = manifestHash(manifest);
                    await prisma.moduleConfig.upsert({
                        where: { id: moduleId },
                        update: { enabled: true, name: manifest.name, manifestHash: hash },
                        create: {
                            id: moduleId,
                            name: manifest.name,
                            enabled: true,
                            manifestHash: hash,
                        },
                    });
                    // Module strings live in the Translation table, not in a
                    // bundled JSON file, so a module installed without this
                    // step renders its raw keys ("store.title") forever. The
                    // marketplace installer has always done it; the wizard,
                    // which is how most installs actually get their modules,
                    // did not.
                    if (manifest.translations) {
                        await syncModuleTranslations(moduleId, manifest.translations);
                    }
                    const { doActionAsync, HookNames } = await import("@/core/lib/hooks");
                    await doActionAsync(HookNames.MODULE_INSTALLED, { moduleId });

                    installedModules.push(moduleId);
                    registryNeedsRegen = true;
                } catch (err) {
                    log.error(`[setup] Failed to install module "${moduleId}"`, { error: err instanceof Error ? err.message : String(err) });
                    failedModules.push({
                        id: moduleId,
                        reason: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }

        if (registryNeedsRegen) {
            // Run the schema merge + registry regeneration best-effort. These
            // scripts are safe to re-run; failures don't break the setup flow.
            try {
                execFileSync(...toolCommand(["npx", "tsx", "scripts/merge-schemas.ts"]), {
                    cwd: process.cwd(),
                    timeout: 60000,
                    stdio: "pipe",
                });
                // Create the tables the merged schema declares. Only one of
                // the twenty-six modules that ship a schema.prisma also ships
                // a migrations/ directory: migrations cover changes *after*
                // a module's initial release, and the
                // schema is what creates the tables the first time. Without
                // this, every module the wizard installs comes up enabled and
                // tableless: Prisma P2021 on its first request.
                execFileSync(...toolCommand(["npx", "tsx", "scripts/apply-schema-additions.ts"]), {
                    cwd: process.cwd(),
                    timeout: 120000,
                    stdio: "pipe",
                });
            } catch (err) {
                // Non-fatal, but the operator needs to know: a failed merge
                // means the step above did not run, and a failed apply means
                // the modules below have no tables.
                log.error("[setup] Schema merge/additions failed", { error: err instanceof Error ? err.message : String(err) });
            }
            try {
                execFileSync(...toolCommand(["npx", "tsx", "scripts/generate-registry.ts"]), {
                    cwd: process.cwd(),
                    timeout: 60000,
                    stdio: "pipe",
                });
            } catch {
                /* non-fatal */
            }
            // Per-module SQL migrations. Setup never ran these, so a module
            // shipping migrations installed with none of its tables - the
            // module then failed at first use with a Prisma error rather than
            // anything the operator could act on.
            for (const moduleId of installedModules) {
                try {
                    execFileSync(...toolCommand(["npx", "tsx", "scripts/apply-migrations.ts", `--module=${moduleId}`]), {
                        cwd: process.cwd(),
                        timeout: 120000,
                        stdio: "pipe",
                    });
                } catch (err) {
                    log.error(`[setup] Migrations failed for "${moduleId}"`, { error: err instanceof Error ? err.message : String(err) });
                    failedModules.push({ id: moduleId, reason: "migrations failed" });
                }
            }
        }

        await invalidateModuleCache().catch(() => {});

        // ---------- Activity log (best-effort) ----------
        try {
            await prisma.activityLog.create({
                data: {
                    userId: adminUser.id,
                    action: "setup.complete",
                    entity: "system",
                    entityId: null,
                    metadata: {
                        installedModules,
                        autoAdded,
                        failedModules,
                        theme: data.theme,
                    },
                },
            });
        } catch {
            /* non-fatal */
        }

        markSetupComplete();

        return NextResponse.json({
            success: true,
            redirectTo: "/admin",
            installedModules,
            // Dependencies the operator did not pick but that had to come
            // along. Surfaced so the wizard can say what it installed.
            autoAdded,
            failedModules,
        });
    } catch (err) {
        return NextResponse.json(
            { error: "Setup failed", details: devOnlyDetail(err) },
            { status: 500 },
        );
    }
}

/**
 * Reads the shipped marketplace catalog for dependency planning.
 *
 * Returns an empty catalog when the file is unreadable - `resolveInstallPlan`
 * then reports every requested module as unknown, which is the honest outcome:
 * without a catalog we cannot know what a module needs.
 */
async function loadCatalog(): Promise<CatalogEntry[]> {
    try {
        const raw = await fs.readFile(path.join(MARKETPLACE_DIR, "index.json"), "utf8");
        const parsed = JSON.parse(raw) as {
            modules?: Array<{
                id?: string;
                version?: string;
                dependencies?: string[];
                conflicts?: string[];
                coreVersion?: string | null;
            }>;
        };
        return (parsed.modules ?? [])
            .filter((m): m is { id: string; version?: string } & typeof m => typeof m.id === "string")
            .map((m) => ({
                id: m.id,
                version: m.version ?? "0.0.0",
                dependencies: m.dependencies ?? [],
                conflicts: m.conflicts ?? [],
                ...(m.coreVersion ? { coreVersion: m.coreVersion } : {}),
            }));
    } catch (err) {
        log.error("[setup] Could not read the marketplace catalog", { error: err instanceof Error ? err.message : String(err) });
        return [];
    }
}

/**
 * The parts of a module manifest this route uses. Modules declare far more
 * than this; the wizard only needs the display name and the strings.
 */
interface LocalModuleManifest {
    name: string;
    translations?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
}

/**
 * Reads and minimally validates `module.json` from an extracted module.
 */
async function readLocalManifest(moduleId: string, manifestPath: string): Promise<LocalModuleManifest> {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
        throw new Error("module.json is not an object");
    }
    const manifest = parsed as LocalModuleManifest;
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
        manifest.name = moduleId;
    }
    return manifest;
}

/**
 * Extracts a marketplace ZIP that already ships with the platform into
 * `src/modules/[id]/`. Uses the same validation rules as the full marketplace
 * installer but skips the GitHub download since we're using local files.
 *
 * Returns the module's manifest so the caller can record its name and hash and
 * load its translations.
 */
async function installModuleFromLocalMarketplace(moduleId: string): Promise<LocalModuleManifest> {
    if (!/^[a-z0-9-]+$/.test(moduleId)) {
        throw new Error("Invalid module id");
    }

    const zipPath = path.join(MARKETPLACE_DIR, `${moduleId}.zip`);

    const targetDir = path.join(MODULES_DIR, moduleId);
    const targetExists = await fs
        .access(targetDir)
        .then(() => true)
        .catch(() => false);
    if (targetExists) {
        // Already extracted - nothing to unpack, but the caller still needs
        // the manifest to register the module and load its strings.
        return readLocalManifest(moduleId, path.join(targetDir, "module.json"));
    }

    // Read rather than asked about. Checking a path exists and then opening
    // it leaves a window between the two, and the answer to "is it there" is
    // the read itself.
    let buffer: Buffer;
    try {
        buffer = await fs.readFile(zipPath);
    } catch {
        throw new Error(`Module ${moduleId} not present in marketplace`);
    }
    if (buffer.length > MAX_MODULE_SIZE) {
        throw new Error("Module ZIP too large");
    }
    if (
        buffer.length < 4 ||
        buffer[0] !== 0x50 ||
        buffer[1] !== 0x4b ||
        buffer[2] !== 0x03 ||
        buffer[3] !== 0x04
    ) {
        throw new Error("Invalid ZIP file");
    }

    const zip = new AdmZip(buffer);
    // The same rules the marketplace installer applies, rather than a smaller
    // set written out again here: entry count, uncompressed size, compression
    // ratio, symlinks and file types, none of which the compressed size of
    // the file above says anything about. The resolve below stays as well;
    // traversal is worth refusing twice.
    const shape = validateZipEntries(zip.getEntries());
    if (!shape.ok) {
        throw new Error(`Module archive rejected: ${shape.error}`);
    }

    await fs.mkdir(targetDir, { recursive: true });
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        if (entry.entryName.includes("../")) continue;
        const resolvedPath = path.resolve(targetDir, entry.entryName);
        if (!resolvedPath.startsWith(path.resolve(targetDir) + path.sep)) continue;
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, entry.getData());
    }

    const manifestPath = path.join(targetDir, "module.json");
    const hasManifest = await fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false);
    if (!hasManifest) {
        await fs.rm(targetDir, { recursive: true, force: true });
        throw new Error("Extracted module missing module.json");
    }

    try {
        return await readLocalManifest(moduleId, manifestPath);
    } catch (err) {
        // A manifest we cannot parse is not something to install half of.
        await fs.rm(targetDir, { recursive: true, force: true });
        throw new Error(`Unreadable module.json: ${err instanceof Error ? err.message : String(err)}`);
    }
}
