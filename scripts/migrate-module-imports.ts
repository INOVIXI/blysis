/**
 * Rewrites module source imports from core's internal layout (`@/core/lib/*`)
 * onto the public SDK (`@/core/sdk*`).
 *
 * Run with `--dry-run` first. Anything the mapping doesn't cover is printed as
 * an unmapped symbol rather than guessed at - that report is the signal that
 * the SDK is missing something, and the whole point of doing this as a codemod
 * instead of by hand.
 *
 * Usage:
 *   npx tsx scripts/migrate-module-imports.ts [path] [--dry-run] [--quiet]
 */
import fs from "fs";
import path from "path";

const ENTRY = {
    ISO: "@/core/sdk",
    SERVER: "@/core/sdk/server",
    AUTH: "@/core/sdk/auth",
    NAV: "@/core/sdk/navigation",
    THEME: "@/core/sdk/theme",
    UI: "@/core/sdk/ui",
    LAYOUT: "@/core/sdk/layout",
    ADMIN: "@/core/sdk/admin",
} as const;

type Entry = (typeof ENTRY)[keyof typeof ENTRY];

/**
 * symbol -> SDK entry point, keyed by the core module it used to come from so
 * a name that exists in two places can't be mapped to the wrong one.
 *
 * `LIB_MAP` covers `@/core/lib/*`, `COMPONENT_MAP` covers
 * `@/core/components/*`; they are matched by two passes over the same file.
 */
const COMPONENT_MAP: Record<string, Record<string, Entry>> = {
    "ui/button": { Button: ENTRY.UI },
    "ui/card": {
        Card: ENTRY.UI, CardHeader: ENTRY.UI, CardTitle: ENTRY.UI, CardContent: ENTRY.UI,
    },
    "ui/input": { Input: ENTRY.UI },
    "ui/label": { Label: ENTRY.UI },
    "ui/textarea": { Textarea: ENTRY.UI },
    "ui/select": {
        Select: ENTRY.UI, SelectTrigger: ENTRY.UI, SelectValue: ENTRY.UI,
        SelectContent: ENTRY.UI, SelectItem: ENTRY.UI,
    },
    "ui/skeleton": { Skeleton: ENTRY.UI },
    "ui/confirm-dialog": { useConfirm: ENTRY.UI },
    "ui/rich-text-editor": { RichTextEditor: ENTRY.UI },
    "ui/file-upload": { FileUpload: ENTRY.UI },
    "ui/footer-dropdown": { FooterDropdown: ENTRY.UI },
    "layout": { Navbar: ENTRY.LAYOUT, Footer: ENTRY.LAYOUT },
    "layout/SidebarLayout": { StandardSidebarLayout: ENTRY.LAYOUT },
    "Slot": { Slot: ENTRY.LAYOUT },
    "theme/ThemeComponentSlot": { ThemeComponentSlot: ENTRY.THEME },
    "admin/AdminCrudPage": { AdminCrudPage: ENTRY.ADMIN, CrudField: ENTRY.ADMIN },
    "admin/SettingsForm": { SettingsForm: ENTRY.ADMIN, SettingsField: ENTRY.ADMIN },
};

const LIB_MAP: Record<string, Record<string, Entry>> = {
    "utils": {
        cn: ENTRY.ISO, formatCurrency: ENTRY.ISO, formatDate: ENTRY.ISO,
        slugify: ENTRY.ISO, generateSlug: ENTRY.ISO, generateOrderNumber: ENTRY.ISO,
    },
    "sanitize": { sanitizeHtml: ENTRY.SERVER },
    "hooks": {
        addAction: ENTRY.ISO, addFilter: ENTRY.ISO, doAction: ENTRY.ISO,
        doActionAsync: ENTRY.ISO, applyFilters: ENTRY.ISO,
        applyFiltersAsync: ENTRY.ISO, HookNames: ENTRY.ISO,
    },
    "api-utils": {
        apiSuccess: ENTRY.SERVER, apiError: ENTRY.SERVER, apiPaginated: ENTRY.SERVER,
        devOnlyDetail: ENTRY.SERVER, withRateLimit: ENTRY.SERVER,
    },
    "email": { sendEmail: ENTRY.SERVER, queueEmail: ENTRY.SERVER },
    "theme-config-client": { useThemeConfig: ENTRY.THEME },
    "db": { prisma: ENTRY.SERVER },
    "permissions": {
        hasPermission: ENTRY.SERVER, hasResourcePermission: ENTRY.SERVER, isAdmin: ENTRY.SERVER,
    },
    "rate-limit": {
        getClientIP: ENTRY.SERVER, rateLimits: ENTRY.SERVER,
        rateLimitForRole: ENTRY.SERVER, rateLimitForRoleAsync: ENTRY.SERVER,
    },
    "cache": { cached: ENTRY.SERVER, invalidate: ENTRY.SERVER },
    "secret-storage": { encryptSecret: ENTRY.SERVER, decryptSecret: ENTRY.SERVER },
    "activity-log": { logActivity: ENTRY.SERVER },
    "module-cache": { isModuleEnabled: ENTRY.SERVER },
    "revisions": { recordRevision: ENTRY.SERVER },
    "storage": {
        sanitizeFilename: ENTRY.SERVER, StorageProvider: ENTRY.SERVER, UploadResult: ENTRY.SERVER,
    },
    "two-factor": {
        generateSecret: ENTRY.SERVER, generateQRCode: ENTRY.SERVER, verifyToken: ENTRY.SERVER,
        generateBackupCodes: ENTRY.SERVER, countRemainingBackupCodes: ENTRY.SERVER,
    },
    "seo": { buildArticleJsonLd: ENTRY.SERVER },
    "auth": { auth: ENTRY.AUTH },
    "i18n/navigation": {
        Link: ENTRY.NAV, useRouter: ENTRY.NAV, redirect: ENTRY.NAV, usePathname: ENTRY.NAV,
    },
};

/**
 * Where a file's default export is re-exported under a name. `prisma` is also
 * a named export of db.ts; `SidebarLayout` only has a default.
 */
const DEFAULT_EXPORT_NAME: Record<string, string> = {
    db: "prisma",
    "layout/SidebarLayout": "StandardSidebarLayout",
};

interface Specifier {
    /** Exported name in the SDK. */
    imported: string;
    /** Local alias, equal to `imported` when there is none. */
    local: string;
    isType: boolean;
}

interface Unmapped {
    file: string;
    lib: string;
    symbol: string;
}

const unmapped: Unmapped[] = [];

function parseSpecifiers(clause: string, wholeClauseIsType: boolean): Specifier[] {
    return clause
        .replace(/^\{|\}$/g, "")
        .split(",")
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => {
            let isType = wholeClauseIsType;
            let body = raw;
            if (/^type\s+/.test(body)) {
                isType = true;
                body = body.replace(/^type\s+/, "");
            }
            const [imported, local] = body.split(/\s+as\s+/).map((x) => x.trim());
            return { imported, local: local ?? imported, isType };
        });
}

function renderSpecifier(s: Specifier): string {
    const name = s.local === s.imported ? s.imported : `${s.imported} as ${s.local}`;
    return s.isType ? `type ${name}` : name;
}

/**
 * One import statement per SDK entry point, types folded in with the `type`
 * keyword so a file never ends up with two statements for the same module.
 */
function renderImports(byEntry: Map<Entry, Specifier[]>): string {
    // Every entry point must appear here: `filter` below drops anything
    // missing, which silently deletes the import instead of rewriting it.
    const order: Entry[] = [
        ENTRY.ISO, ENTRY.SERVER, ENTRY.AUTH, ENTRY.NAV,
        ENTRY.UI, ENTRY.LAYOUT, ENTRY.ADMIN, ENTRY.THEME,
    ];
    const missing = [...byEntry.keys()].filter((e) => !order.includes(e));
    if (missing.length > 0) {
        throw new Error(
            `renderImports has no ordering for: ${missing.join(", ")} - add them to \`order\`.`,
        );
    }
    return order
        .filter((e) => byEntry.has(e))
        .map((e) => {
            const specs = byEntry.get(e)!;
            const seen = new Set<string>();
            const unique = specs.filter((s) => {
                const key = `${s.imported}|${s.local}|${s.isType}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            unique.sort((a, b) => a.imported.localeCompare(b.imported));
            return `import { ${unique.map(renderSpecifier).join(", ")} } from "${e}";`;
        })
        .join("\n");
}

function migrateFile(file: string, relPath: string): { changed: boolean; content: string } {
    const original = fs.readFileSync(file, "utf8");
    let content = original;

    // --- Static imports ----------------------------------------------------
    // Matches `import { a, type b } from "@/core/lib/x"`,
    // `import type { a } from "..."` and `import prisma from "..."`, for both
    // the lib and component trees.
    const passes: Array<{ re: RegExp; map: Record<string, Record<string, Entry>>; label: string }> = [
        {
            re: /^[ \t]*import\s+(type\s+)?(\{[^{}]*\}|[A-Za-z_$][\w$]*)\s+from\s+["']@\/core\/lib\/([A-Za-z0-9/_-]+)["'];?[ \t]*\r?\n/gm,
            map: LIB_MAP,
            label: "lib",
        },
        {
            re: /^[ \t]*import\s+(type\s+)?(\{[^{}]*\}|[A-Za-z_$][\w$]*)\s+from\s+["']@\/core\/components\/([A-Za-z0-9/_-]+)["'];?[ \t]*\r?\n/gm,
            map: COMPONENT_MAP,
            label: "components",
        },
    ];

    const collected = new Map<Entry, Specifier[]>();
    let firstMatchIndex = -1;
    let sawStatic = false;

    for (const pass of passes) {
    content = content.replace(pass.re, (match, typeKw, clause, lib, offset: number) => {
        const table = pass.map[lib];
        if (!table) {
            unmapped.push({ file: relPath, lib: `${pass.label}:${lib}`, symbol: "(whole module)" });
            return match;
        }

        const specs: Specifier[] = clause.startsWith("{")
            ? parseSpecifiers(clause, Boolean(typeKw))
            : [
                  {
                      imported: DEFAULT_EXPORT_NAME[lib] ?? clause,
                      local: clause,
                      isType: Boolean(typeKw),
                  },
              ];

        const resolved: Specifier[] = [];
        for (const s of specs) {
            const entry = table[s.imported];
            if (!entry) {
                unmapped.push({ file: relPath, lib: `${pass.label}:${lib}`, symbol: s.imported });
                // Leave the whole statement alone; a partially rewritten import
                // would silently drop a symbol.
                return match;
            }
            resolved.push(s);
        }

        for (const s of resolved) {
            const entry = table[s.imported]!;
            if (!collected.has(entry)) collected.set(entry, []);
            collected.get(entry)!.push(s);
        }

        if (firstMatchIndex === -1 || offset < firstMatchIndex) firstMatchIndex = offset;
        sawStatic = true;
        return "";
    });
    }

    if (sawStatic && collected.size > 0) {
        const block = renderImports(collected) + "\n";
        // Re-insert where the first old import stood, preserving import order
        // relative to the file's other imports.
        content = content.slice(0, firstMatchIndex) + block + content.slice(firstMatchIndex);
    }

    // --- Dynamic imports ---------------------------------------------------
    // `const { recordRevision } = await import("@/core/lib/revisions")`.
    // A static-only codemod would report success while leaving these behind.
    content = content.replace(
        /import\(\s*["']@\/core\/lib\/([a-z0-9/-]+)["']\s*\)/g,
        (match, lib: string) => {
            const table = LIB_MAP[lib];
            if (!table) {
                unmapped.push({ file: relPath, lib, symbol: "(dynamic import)" });
                return match;
            }
            const entries = new Set(Object.values(table));
            if (entries.size !== 1) {
                // The lib is split across entry points, so which one this call
                // wants depends on the destructuring. Report instead of guess.
                unmapped.push({ file: relPath, lib, symbol: "(dynamic import, ambiguous entry)" });
                return match;
            }
            return `import("${[...entries][0]}")`;
        },
    );

    return { changed: content !== original, content };
}

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
    return out;
}

function main(): void {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const quiet = args.includes("--quiet");
    const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? "module-sources");

    const files = walk(root);
    let changedCount = 0;

    for (const file of files) {
        const rel = path.relative(process.cwd(), file);
        const { changed, content } = migrateFile(file, rel);
        if (!changed) continue;
        changedCount++;
        if (!dryRun) fs.writeFileSync(file, content);
        if (!quiet) console.log(`${dryRun ? "would rewrite" : "rewrote"}  ${rel}`);
    }

    console.log(
        `\n${dryRun ? "Would rewrite" : "Rewrote"} ${changedCount} of ${files.length} file(s) under ${path.relative(process.cwd(), root) || "."}`,
    );

    if (unmapped.length > 0) {
        const grouped = new Map<string, Set<string>>();
        for (const u of unmapped) {
            const key = `${u.lib}::${u.symbol}`;
            if (!grouped.has(key)) grouped.set(key, new Set());
            grouped.get(key)!.add(u.file);
        }
        console.log(`\n${grouped.size} symbol(s) have no SDK mapping - statements left untouched:`);
        for (const [key, filesFor] of [...grouped].sort()) {
            const [lib, symbol] = key.split("::");
            const path = lib.startsWith("components:")
                ? `@/core/components/${lib.slice("components:".length)}`
                : `@/core/lib/${lib.replace(/^lib:/, "")}`;
            console.log(`  ${path} -> ${symbol}  (${filesFor.size} file(s))`);
            for (const f of [...filesFor].slice(0, 3)) console.log(`      ${f}`);
            if (filesFor.size > 3) console.log(`      ... and ${filesFor.size - 3} more`);
        }
        console.log("\nAdd these to the SDK (and to MAP in this script), then re-run.");
        process.exitCode = 1;
    } else {
        console.log("Every import mapped cleanly.");
    }
}

main();
