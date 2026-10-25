import { prisma } from "@/core/lib/db";
import { ModuleSearchIndexes } from "@/core/generated/module-search";
import { searchDocument } from "@/core/lib/search-text";

/**
 * Idempotent creation of GIN tsvector indexes for module searchable tables.
 * Runs once per process from src/instrumentation.ts, or manually via
 * `npx tsx scripts/ensure-search-indexes.ts`.
 *
 * The table list is generated from module manifests, not written here. It used
 * to be a hardcoded array naming `BlogArticle`, `ForumTopic`, `HelpArticle`
 * and `Product` - four module tables named in core, which is the one thing
 * this project's architecture forbids, and which logged an error per
 * uninstalled module on every single boot.
 *
 * Identifiers reach here from `module.json`, validated against
 * `^[A-Za-z][A-Za-z0-9_]*$` by the manifest schema before a module can be
 * installed. That is what makes the interpolation below safe; the expression
 * itself is built by core in `search-text.ts`, so a module never supplies SQL.
 */
async function ensureIndexes(): Promise<void> {
    for (const idx of ModuleSearchIndexes) {
        const table = `"${idx.table}"`;
        // Named for the folding document: an index on the expression before it
        // folded ı and İ is one no search uses any more, and goes.
        const name = `"${idx.table}_fts_fold_idx"`;
        const before = `"${idx.table}_fts_idx"`;
        try {
            // A module can be installed but not yet migrated. Probe first so a
            // missing table is a skip rather than a failed CREATE INDEX.
            await prisma.$executeRawUnsafe(`SELECT 1 FROM ${table} LIMIT 1`);
            await prisma.$executeRawUnsafe(
                `CREATE INDEX IF NOT EXISTS ${name} ON ${table} USING GIN (${searchDocument(idx.columns)})`
            );
            await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${before}`);
            console.log(`[search-indexes] ensured ${name} for ${idx.module}`);
        } catch (err) {
            console.warn(
                `[search-indexes] skipped ${name}:`,
                err instanceof Error ? err.message : String(err)
            );
        }
    }
}

// CLI entrypoint
if (require.main === module) {
    ensureIndexes()
        .then(() => prisma.$disconnect())
        .catch((err) => {
            console.error("[search-indexes] fatal:", err);
            process.exit(1);
        });
}

export { ensureIndexes };
