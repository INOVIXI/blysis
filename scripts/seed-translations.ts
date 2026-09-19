/**
 * Seed core translations from messages-core/*.json into the Translation table.
 * Also seeds translations from all installed modules' module.json manifests.
 *
 * Idempotent - safe to run multiple times. Upserts, never duplicates.
 *
 * `getMessages()` only reads rows whose module is core or an *enabled* module,
 * so seeding a module's strings does nothing on its own: a module that is on
 * disk but has no `ModuleConfig` row still renders "store.title" where the
 * title belongs. Copying `module-sources/` into `src/modules/` is the
 * documented fast path for local work and it leaves exactly that gap.
 *
 * `--register-modules` closes it by writing the row the marketplace installer
 * and the setup wizard write. It is opt-in because this script also runs on
 * every container boot, where enabling whatever happens to be on disk would
 * override what an operator turned off.
 *
 * Usage: npx tsx scripts/seed-translations.ts [--register-modules]
 */

// Reads DATABASE_URL from .env - this script is run directly via tsx,
// outside Next.js, which is what normally loads the env file.
import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { locales } from "../src/core/lib/i18n/config";
import { manifestHash } from "../src/core/lib/module-install-audit";

/** Off by default: see the note above about container boots. */
const REGISTER_MODULES = process.argv.includes("--register-modules");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const CORE_DIR = path.join(process.cwd(), "messages-core");
const MODULES_DIR = path.join(process.cwd(), "src/modules");

// Only seed translations for locales the app actually supports. A stray
// `messages-core/zz.json` (or a module manifest declaring an unknown
// locale) would otherwise pollute the Translation table with rows that
// no request handler ever reads.
const SUPPORTED_LOCALES = new Set<string>(locales);

function flattenObject(
    obj: Record<string, unknown>,
    prefix: string,
    emit: (key: string, value: string) => void,
): void {
    for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            flattenObject(v as Record<string, unknown>, fullKey, emit);
        } else {
            emit(fullKey, String(v ?? ""));
        }
    }
}

/**
 * The stored rows this catalogue no longer ships.
 *
 * A namespace and a key together name a string; either alone does not, and
 * comparing on the key would keep a row whose namespace has moved and delete
 * one that only shares a key with something else.
 */
export function staleTranslations<T extends { namespace: string; key: string }>(
    shipped: { namespace: string; key: string }[],
    stored: T[],
): T[] {
    // A catalogue that ships nothing is a read that failed, not an
    // instruction to empty the table.
    if (shipped.length === 0) return [];

    const names = new Set(shipped.map((r) => `${r.namespace}\u0000${r.key}`));
    return stored.filter((row) => !names.has(`${row.namespace}\u0000${row.key}`));
}

async function seedLocale(
    locale: string,
    data: Record<string, unknown>,
    moduleId: string,
): Promise<number> {
    const rows: { locale: string; namespace: string; key: string; value: string; module: string }[] = [];

    for (const [namespace, content] of Object.entries(data)) {
        if (typeof content === "string") {
            rows.push({ locale, namespace, key: "_root", value: content, module: moduleId });
        } else if (typeof content === "object" && content !== null) {
            flattenObject(content as Record<string, unknown>, "", (key, value) => {
                rows.push({ locale, namespace, key, value, module: moduleId });
            });
        }
    }

    // Two-pass write so admin-customized rows (isCustom = true) survive
    // re-seeding. updateMany refreshes only non-custom rows; upsert with
    // an empty update fills in missing rows without touching customs.
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await Promise.all(
            chunk.map((r) =>
                prisma.translation.updateMany({
                    where: {
                        locale: r.locale,
                        namespace: r.namespace,
                        key: r.key,
                        module: r.module,
                        isCustom: false,
                    },
                    data: { value: r.value },
                }),
            ),
        );
        await Promise.all(
            chunk.map((r) =>
                prisma.translation.upsert({
                    where: {
                        locale_namespace_key_module: {
                            locale: r.locale,
                            namespace: r.namespace,
                            key: r.key,
                            module: r.module,
                        },
                    },
                    update: {},
                    create: r,
                }),
            ),
        );
    }

    /*
     * A key that has left the catalogue leaves the database too.
     *
     * The seeder only ever upserted, so every string ever shipped stayed in
     * the table for the life of the installation. `siteSettings_serverIp` was
     * deleted from core and its two rows were still there afterwards - not
     * rendered anywhere, because nothing asks for a key that no longer
     * exists, but listed by the translations screen as two strings an
     * operator could sit down and translate into a site that would never
     * show them.
     *
     * Only rows this seeder wrote. A row an operator has edited is their
     * text, and deleting it because the key moved would throw away work
     * without asking; the translations screen is where a stranded custom
     * belongs, not here.
     */
    const stored = await prisma.translation.findMany({
        where: { locale, module: moduleId, isCustom: false },
        select: { id: true, namespace: true, key: true },
    });
    const gone = staleTranslations(rows, stored);
    if (gone.length > 0) {
        await prisma.translation.deleteMany({ where: { id: { in: gone.map((row) => row.id) } } });
        console.log(`  ${moduleId}/${locale}: ${gone.length} key(s) no longer shipped, removed`);
    }

    return rows.length;
}

async function main() {
    console.log("Seeding translations...\n");

    // 1. Core translations
    if (!fs.existsSync(CORE_DIR)) {
        console.error("messages-core/ not found");
        process.exit(1);
    }

    const coreFiles = fs.readdirSync(CORE_DIR).filter((f) => f.endsWith(".json"));
    let coreTotal = 0;
    for (const file of coreFiles) {
        const locale = file.replace(".json", "");
        if (!SUPPORTED_LOCALES.has(locale)) {
            console.log(`  core/${locale}: SKIPPED (not in locales config)`);
            continue;
        }
        const data = JSON.parse(fs.readFileSync(path.join(CORE_DIR, file), "utf-8"));
        const count = await seedLocale(locale, data, "core");
        coreTotal += count;
        console.log(`  core/${locale}: ${count} keys`);
    }
    console.log(`  Core total: ${coreTotal} keys\n`);

    // 2. Module translations
    if (!fs.existsSync(MODULES_DIR)) {
        console.log("No modules installed. Done.");
        return;
    }

    const modules = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory());

    let modTotal = 0;
    let registered = 0;
    for (const mod of modules) {
        const manifestPath = path.join(MODULES_DIR, mod.name, "module.json");
        if (!fs.existsSync(manifestPath)) continue;

        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const moduleId = manifest.id || mod.name;

        if (REGISTER_MODULES) {
            // `enabled` is set on create only. A row that already exists
            // carries an operator's decision, and re-running a seed is not
            // a reason to overturn it.
            await prisma.moduleConfig.upsert({
                where: { id: moduleId },
                update: { name: manifest.name ?? moduleId, manifestHash: manifestHash(manifest) },
                create: {
                    id: moduleId,
                    name: manifest.name ?? moduleId,
                    enabled: true,
                    manifestHash: manifestHash(manifest),
                },
            });
            registered += 1;
        }

        const translations = manifest.translations;
        if (!translations || typeof translations !== "object") continue;

        let modCount = 0;
        for (const [locale, data] of Object.entries(translations as Record<string, Record<string, unknown>>)) {
            if (typeof data !== "object" || data === null) continue;
            if (!SUPPORTED_LOCALES.has(locale)) continue;
            const count = await seedLocale(locale, data, moduleId);
            modCount += count;
        }

        if (modCount > 0) {
            console.log(`  ${moduleId}: ${modCount} keys`);
            modTotal += modCount;
        }
    }

    console.log(`  Module total: ${modTotal} keys`);
    if (REGISTER_MODULES) console.log(`  Registered ${registered} module(s) in ModuleConfig`);
    console.log(`\nDone. ${coreTotal + modTotal} total translation keys seeded.`);
    if (!REGISTER_MODULES) {
        console.log("Module strings stay invisible until each module has a ModuleConfig row.");
        console.log("For a local tree seeded from module-sources/, re-run with --register-modules.");
    }
}

// Guarded so the helpers above can be imported and tested without this
// script connecting to a database and rewriting every string in it.
if (process.argv[1] && process.argv[1].endsWith("seed-translations.ts")) {
    main()
        .catch((e) => { console.error(e); process.exit(1); })
        .finally(() => prisma.$disconnect());
}
