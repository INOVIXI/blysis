import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { moduleManifestSchema } from "../src/core/lib/module-manifest-schema";
import { checkManifestFileRefs } from "../src/core/lib/module-ref-resolver";

const ROOT = process.cwd();

interface CheckResult {
    name: string;
    passed: boolean;
    message: string;
    suggestion?: string;
}

function usage(): never {
    console.error("Usage: npx tsx scripts/validate-module.ts <module-path>");
    console.error("       npx tsx scripts/validate-module.ts --all   (every module in module-sources/)");
    console.error("");
    console.error("  module-path   Path to the module directory (e.g., module-sources/my-module)");
    console.error("");
    console.error("Example:");
    console.error("  npx tsx scripts/validate-module.ts module-sources/store");
    process.exit(1);
}

function checkManifestExists(modulePath: string): CheckResult {
    const manifestPath = path.join(modulePath, "module.json");

    if (!fs.existsSync(manifestPath)) {
        return {
            name: "module.json exists",
            passed: false,
            message: "module.json not found",
            suggestion: "Create a module.json file. See module-template/module.json for reference.",
        };
    }

    try {
        JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        return { name: "module.json exists", passed: true, message: "Valid JSON" };
    } catch (err) {
        return {
            name: "module.json exists",
            passed: false,
            message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            suggestion: "Fix the JSON syntax in module.json.",
        };
    }
}

function checkRequiredFields(modulePath: string): CheckResult {
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name: "Required fields", passed: false, message: "No module.json to check" };
    }

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const required = ["id", "name", "version"];
        const missing = required.filter((f) => !manifest[f]);

        if (missing.length > 0) {
            return {
                name: "Required fields",
                passed: false,
                message: `Missing: ${missing.join(", ")}`,
                suggestion: `Add the missing fields to module.json: ${missing.join(", ")}`,
            };
        }

        return { name: "Required fields", passed: true, message: "id, name, version present" };
    } catch {
        return { name: "Required fields", passed: false, message: "Cannot parse module.json" };
    }
}

function checkIdFormat(modulePath: string): CheckResult {
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name: "ID format", passed: false, message: "No module.json to check" };
    }

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const id = manifest.id;

        if (!id) {
            return { name: "ID format", passed: false, message: "No id field" };
        }

        if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(id)) {
            return {
                name: "ID format",
                passed: false,
                message: `Invalid ID "${id}"`,
                suggestion: "ID must be lowercase alphanumeric + hyphens, start with a letter, end with alphanumeric.",
            };
        }

        if (id.includes("--")) {
            return {
                name: "ID format",
                passed: false,
                message: `ID "${id}" contains double hyphens`,
                suggestion: "Remove consecutive hyphens from the ID.",
            };
        }

        return { name: "ID format", passed: true, message: `"${id}" is valid` };
    } catch {
        return { name: "ID format", passed: false, message: "Cannot parse module.json" };
    }
}

function checkManifestSchema(modulePath: string): CheckResult {
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name: "Manifest schema", passed: false, message: "No module.json to check" };
    }

    try {
        const parsed = moduleManifestSchema.safeParse(
            JSON.parse(fs.readFileSync(manifestPath, "utf8")),
        );
        if (parsed.success) {
            return { name: "Manifest schema", passed: true, message: "Matches moduleManifestSchema" };
        }

        // This is the same schema the install, upload and update routes run a
        // manifest through before they touch the disk. Until it was wired in
        // here, a manifest CI called valid could still be refused on install -
        // a ref like `../../src/core/lib/db` passed every check in this script
        // while the routes rejected it outright.
        const issues = parsed.error.issues
            .slice(0, 10)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
        return {
            name: "Manifest schema",
            passed: false,
            message: `${parsed.error.issues.length} problem(s):\n      ${issues.join("\n      ")}`,
            suggestion: "Fix module.json to match the manifest schema in src/core/lib/module-manifest-schema.ts.",
        };
    } catch (err) {
        return {
            name: "Manifest schema",
            passed: false,
            message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

function checkReferencedFiles(modulePath: string): CheckResult {
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name: "Referenced files", passed: false, message: "No module.json to check" };
    }

    try {
        const parsed = moduleManifestSchema.safeParse(
            JSON.parse(fs.readFileSync(manifestPath, "utf8")),
        );
        if (!parsed.success) {
            // The manifest-shape check reports this properly; don't double-fail.
            return { name: "Referenced files", passed: true, message: "Skipped (manifest does not parse)" };
        }

        // Same resolver the install, upload and update routes use. This check
        // used to be a separate hand-rolled walk that covered only five of the
        // keys that can carry a ref and matched the others verbatim, so it
        // passed fourteen modules the install route then refused.
        const { escaping, missing } = checkManifestFileRefs(modulePath, parsed.data);
        const problems = [
            ...escaping.map((r) => `escapes module root: ${r}`),
            ...missing.map((r) => `not found: ${r}`),
        ];

        if (problems.length > 0) {
            return {
                name: "Referenced files",
                passed: false,
                message: `${problems.length} file(s) not found:\n      ${problems.join("\n      ")}`,
                suggestion: "Create the missing files or update the paths in module.json.",
            };
        }

        return { name: "Referenced files", passed: true, message: "All referenced files exist" };
    } catch (err) {
        return {
            name: "Referenced files",
            passed: false,
            message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
function checkNoCoreImports(modulePath: string): CheckResult {
    // Check that module code doesn't import from other modules directly
    const moduleId = path.basename(modulePath);

    function walkFiles(dir: string): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) return results;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walkFiles(fullPath));
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                results.push(fullPath);
            }
        }
        return results;
    }

    const files = walkFiles(modulePath);
    const violations: string[] = [];

    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Check for imports from other modules (not @/core/*, not relative)
            const importMatch = line.match(/from\s+["']@\/modules\/([^/"']+)/);
            if (importMatch && importMatch[1] !== moduleId) {
                const relPath = path.relative(modulePath, file);
                violations.push(`${relPath}:${i + 1} imports from @/modules/${importMatch[1]}`);
            }
        }
    }

    if (violations.length > 0) {
        return {
            name: "No cross-module imports",
            passed: false,
            message: `${violations.length} cross-module import(s):\n      ${violations.slice(0, 5).join("\n      ")}${violations.length > 5 ? `\n      ... and ${violations.length - 5} more` : ""}`,
            suggestion: "Modules should not import directly from other modules. Use core utilities or events instead.",
        };
    }

    return { name: "No cross-module imports", passed: true, message: "No cross-module imports found" };
}

/**
 * Modules must import core through the published SDK (`@/core/sdk*`), never
 * through core's internal layout (`@/core/lib/*`, `@/core/components/*`).
 *
 * This is the gate that actually holds the boundary: ESLint globally ignores
 * `module-sources/**` and `src/modules/**`, and the main tsconfig excludes
 * module sources, so neither would catch a violation. This check runs in
 * `build-marketplace.sh` and in CI, and covers third-party ZIPs at authoring
 * time.
 */
function checkSdkImports(modulePath: string): CheckResult {
    function walkFiles(dir: string): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walkFiles(fullPath));
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                results.push(fullPath);
            }
        }
        return results;
    }

    const violations: string[] = [];
    // Anything under `@/core/` that is not the published SDK. It used to name
    // `lib` and `components` only, and thirteen module files walked straight
    // through the gap into `@/core/hooks/*` - two formatters the SDK simply
    // did not carry, so the boundary was holding back the wrong thing. The
    // generated contract types are the one exception: `@/core/generated/*` is
    // where a module reads the shape of a contribution it declares, and that
    // is the intended way in.
    const deepImport = /["']@\/core\/(?!sdk\b|generated\/)[^"']*["']/;

    for (const file of walkFiles(modulePath)) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (deepImport.test(lines[i])) {
                violations.push(`${path.relative(modulePath, file)}:${i + 1}`);
            }
        }
    }

    if (violations.length > 0) {
        return {
            name: "SDK imports only",
            passed: false,
            message: `${violations.length} import(s) reach into core internals:\n      ${violations.slice(0, 5).join("\n      ")}${violations.length > 5 ? `\n      ... and ${violations.length - 5} more` : ""}`,
            suggestion: "Import from @/core/sdk (isomorphic), or one of @/core/sdk/{server,auth,navigation,blocks,theme,ui,layout,admin}. Run `npx tsx scripts/migrate-module-imports.ts <path>` to rewrite them.",
        };
    }

    return { name: "SDK imports only", passed: true, message: "No @/core/lib or @/core/components imports" };
}

function checkSchemaPrisma(modulePath: string): CheckResult {
    const schemaPath = path.join(modulePath, "schema.prisma");

    if (!fs.existsSync(schemaPath)) {
        return { name: "schema.prisma", passed: true, message: "No schema.prisma (optional)" };
    }

    const content = fs.readFileSync(schemaPath, "utf8");

    const hasUserRelations = content.includes("@@user-relations-start");

    // Check for basic model definitions. A schema whose only job is to add
    // fields to the core User model (two-factor-auth) legitimately declares
    // no models of its own.
    const modelCount = (content.match(/^model\s+\w+/gm) || []).length;
    if (modelCount === 0 && !hasUserRelations) {
        return {
            name: "schema.prisma",
            passed: false,
            message: "No model definitions found",
            suggestion: "Add at least one Prisma model or a @@user-relations-start/end block, or remove schema.prisma if not needed.",
        };
    }

    // A field typed `User` needs the reverse field on the core User model,
    // and merge-schemas only emits those from the relations block - without
    // it the merged schema does not validate. A bare `userId String` column
    // with no `@relation` is a deliberate loose reference (anonymous form
    // submissions, records that outlive their author) and needs nothing.
    const relatesToUser = /^\s*\w+\s+User(\[\]|\?)?(\s|$)/m.test(content);

    if (relatesToUser && !hasUserRelations) {
        return {
            name: "schema.prisma",
            passed: false,
            message: "Models declare a User relation but no @@user-relations-start/end block",
            suggestion: "Add a @@user-relations-start/end comment block declaring the reverse field on User.",
        };
    }

    // Check for @id @default(cuid()) on models
    const models = content.match(/model\s+\w+\s*\{[^}]+\}/g) || [];
    const missingId: string[] = [];
    for (const model of models) {
        const modelName = model.match(/model\s+(\w+)/)?.[1];
        if (modelName && !model.includes("@id")) {
            missingId.push(modelName);
        }
    }

    if (missingId.length > 0) {
        return {
            name: "schema.prisma",
            passed: false,
            message: `Models missing @id: ${missingId.join(", ")}`,
            suggestion: "Every model should have an @id field.",
        };
    }

    return {
        name: "schema.prisma",
        passed: true,
        message: `Valid (${modelCount} model${modelCount !== 1 ? "s" : ""})`,
    };
}

/**
 * One `typecheck:modules` run, shared by every module this process validates.
 *
 * That script is the only thing that can type-check module code: it builds a
 * throwaway Prisma client from every module schema and compiles against
 * `tsconfig.modules.json`. Running plain `tsc --project tsconfig.json` here
 * instead, as this check used to, could not work - the main tsconfig excludes
 * `module-sources/` entirely, so the program contained none of the files being
 * validated and the check reported a pass no matter what was in them. It let a
 * bad SDK import through that the real gate caught minutes later.
 */
let modulesTypecheck: { output: string } | null = null;

function runModulesTypecheck(): string {
    if (!modulesTypecheck) {
        const result = spawnSync("npx", ["tsx", "scripts/typecheck-modules.ts"], {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 600000,
        });
        modulesTypecheck = { output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    }
    return modulesTypecheck.output;
}

function checkTypeScript(modulePath: string): CheckResult {
    const tsFiles: string[] = [];

    function walkFiles(dir: string): void {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkFiles(fullPath);
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                tsFiles.push(fullPath);
            }
        }
    }

    walkFiles(modulePath);

    if (tsFiles.length === 0) {
        return { name: "TypeScript compilation", passed: true, message: "No TypeScript files" };
    }

    // The typecheck compiles `module-sources/`, so a module kept anywhere else
    // cannot be reached from here. Saying so is the honest answer; claiming a
    // pass is what the old version did.
    const relModulePath = path.relative(ROOT, modulePath).split(path.sep).join("/");
    if (!relModulePath.startsWith("module-sources/")) {
        return {
            name: "TypeScript compilation",
            passed: true,
            message: "Skipped - only modules under module-sources/ can be type-checked",
        };
    }

    try {
        const output = runModulesTypecheck();
        const errorLines = output
            .split("\n")
            .filter((line: string) => line.includes("error TS") && line.includes(`${relModulePath}/`));

        if (errorLines.length > 0) {
            const shown = errorLines.slice(0, 5);
            return {
                name: "TypeScript compilation",
                passed: false,
                message: `TypeScript errors:\n      ${shown.join("\n      ")}${errorLines.length > 5 ? "\n      ..." : ""}`,
                suggestion: "Fix the TypeScript errors shown above.",
            };
        }

        return { name: "TypeScript compilation", passed: true, message: `${tsFiles.length} file(s) pass` };
    } catch (err) {
        return {
            name: "TypeScript compilation",
            passed: false,
            message: `Could not run the module typecheck: ${err instanceof Error ? err.message : String(err)}`,
            suggestion: "Run `npm run typecheck:modules` directly to see what went wrong.",
        };
    }
}

function checkNoAnyTypes(modulePath: string): CheckResult {
    function walkFiles(dir: string): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walkFiles(fullPath));
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                results.push(fullPath);
            }
        }
        return results;
    }

    const files = walkFiles(modulePath);
    const violations: string[] = [];

    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comments
            const trimmed = line.trim();
            if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

            // Match explicit `any` type annotations, but not words containing "any" (e.g., "many", "company")
            // Patterns: `: any`, `<any>`, `as any`, `: any[]`, `any>`, `any,`, `any)`
            if (/(?::\s*any\b|<any\b|as\s+any\b|\bany\s*[>\],)])/.test(line)) {
                const relPath = path.relative(modulePath, file);
                violations.push(`${relPath}:${i + 1}`);
            }
        }
    }

    if (violations.length > 0) {
        return {
            name: "No 'any' types",
            passed: false,
            message: `${violations.length} 'any' type(s) found:\n      ${violations.slice(0, 5).join("\n      ")}${violations.length > 5 ? `\n      ... and ${violations.length - 5} more` : ""}`,
            suggestion: "Replace 'any' with proper types. Use Record<string, unknown> for generic objects.",
        };
    }

    return { name: "No 'any' types", passed: true, message: "No 'any' types found" };
}

/** `@provider-callback:` followed by an actual reason, not just the marker. */
const PROVIDER_CALLBACK = /@provider-callback:[ \t]*\S+/;

function checkApiAuthChecks(modulePath: string): CheckResult {
    function walkFiles(dir: string): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walkFiles(fullPath));
            } else if (entry.name.endsWith(".ts")) {
                results.push(fullPath);
            }
        }
        return results;
    }

    const apiDir = path.join(modulePath, "api");
    if (!fs.existsSync(apiDir)) {
        return { name: "API auth checks", passed: true, message: "No API directory" };
    }

    const files = walkFiles(apiDir);
    const violations: string[] = [];

    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");

        // Check if file has POST, PUT, DELETE, PATCH exports
        const writeMethods = ["POST", "PUT", "DELETE", "PATCH"];
        const hasWriteMethod = writeMethods.some((method) =>
            new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(content)
        );

        if (hasWriteMethod) {
            // Check for auth/session checks
            const hasAuthCheck =
                content.includes("auth()") ||
                content.includes("isAdmin(") ||
                content.includes("isStaff(") ||
                content.includes("hasPermission(") ||
                content.includes("session?.user") ||
                // Provider webhooks have no session by construction: the caller
                // is Stripe/PayPal/Discord, not a browser. They authenticate by
                // verifying a signature over the raw body, which is stronger
                // than a session check for that endpoint. Both markers below
                // are signature verification and cannot appear by accident.
                content.includes("webhooks.constructEvent(") ||
                content.includes("timingSafeEqual(") ||
                // Not every provider signs its callbacks. Several answer the
                // question the other way round: the callback carries nothing
                // but an opaque id, and the route asks the provider's API,
                // with the site's own credentials, what that id is worth. That
                // is authentication too, and it leaves no marker in the source
                // this check could recognise - so the route says so itself,
                // with a reason:
                //
                //     // @provider-callback: Mollie posts only a payment id;
                //     // the status is read back from Mollie with our API key.
                //
                // The reason is required. A bare marker is not a bypass.
                PROVIDER_CALLBACK.test(content);

            if (!hasAuthCheck) {
                const relPath = path.relative(modulePath, file);
                violations.push(relPath);
            }
        }
    }

    if (violations.length > 0) {
        return {
            name: "API auth checks",
            passed: false,
            message: `${violations.length} write endpoint(s) without auth:\n      ${violations.join("\n      ")}`,
            suggestion:
                "Add auth checks (auth(), isAdmin(), etc.) to POST/PUT/DELETE/PATCH handlers. " +
                "A provider callback that verifies by calling the provider back marks itself " +
                "'@provider-callback: <why>' instead.",
        };
    }

    return { name: "API auth checks", passed: true, message: "All write endpoints have auth checks" };
}

/**
 * A hook name is a contract with modules that will never import this one, and
 * nothing fails at runtime when the two halves disagree: a listener on a
 * misspelled hook simply never fires. `hooksEmitted` makes this module's half
 * declarative so it can be checked - here against the module's own source, and
 * in build-marketplace.sh against every listener in the catalog.
 *
 * Only string literals are matched. A dynamically named hook
 * (`doAction(`${resource}.created`, …)`, as core's crud helpers do) cannot be
 * declared and is not required to be.
 */
/**
 * Every admin surface and every write says who may reach it.
 *
 * Core denies a panel path it has no permission for, so a menu item or an
 * admin route that declares none is a screen only an administrator can open -
 * which is the safe failure and still a failure, because nobody decided it.
 * A write is the same question with a second answer available: most of a
 * module's writes are a member's own business rather than an operator's job,
 * and `openTo` is how that is said out loud instead of left blank.
 *
 * The name has to be one the module also declares in `permissions`, or nobody
 * could be granted it and the screen would be unreachable by everyone.
 */
function checkPermissionsDeclared(modulePath: string): CheckResult {
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name: "Permission declarations", passed: true, message: "No manifest" };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        permissions?: { name: string; labelKey: string }[];
        menu?: { path: string; permission?: string }[];
        adminRoutes?: { path: string; permission?: string }[];
        api?: {
            path: string;
            method?: string;
            permission?: string;
            openTo?: string;
            providerCallback?: boolean;
        }[];
    };

    const granted = new Set((manifest.permissions ?? []).map((entry) => entry.name));
    const problems: string[] = [];

    const requiresName = [
        ...(manifest.menu ?? []).map((item) => ({ kind: "menu", path: item.path, permission: item.permission })),
        ...(manifest.adminRoutes ?? []).map((item) => ({ kind: "adminRoute", path: item.path, permission: item.permission })),
    ];

    for (const entry of requiresName) {
        if (!entry.permission) {
            problems.push(`${entry.kind} ${entry.path} declares no permission`);
        } else if (!granted.has(entry.permission)) {
            problems.push(`${entry.kind} ${entry.path} requires ${entry.permission}, which this module does not declare in permissions`);
        }
    }

    for (const entry of manifest.api ?? []) {
        const method = entry.method ?? "ALL";
        if (method === "GET") continue;
        if (entry.providerCallback) continue;
        if (entry.permission && entry.openTo) {
            problems.push(`api ${entry.path} declares both a permission and openTo`);
            continue;
        }
        if (entry.permission) {
            if (!granted.has(entry.permission)) {
                problems.push(`api ${entry.path} requires ${entry.permission}, which this module does not declare in permissions`);
            }
            continue;
        }
        if (!entry.openTo) {
            problems.push(`api ${entry.path} writes and declares neither a permission nor openTo`);
        }
    }

    // A label an operator never sees is worse than a name: the screen falls
    // back to the raw `store.manage`, and nobody notices until they are asked
    // to grant it.
    const translations = (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        translations?: Record<string, Record<string, Record<string, string>>>;
    }).translations ?? {};
    for (const entry of manifest.permissions ?? []) {
        const [namespace, key] = entry.labelKey.split(".");
        for (const [locale, bundle] of Object.entries(translations)) {
            if (typeof bundle?.[namespace]?.[key] !== "string") {
                problems.push(`permission ${entry.name} has no ${locale} label at ${entry.labelKey}`);
            }
        }
    }

    return problems.length === 0
        ? { name: "Permission declarations", passed: true, message: `${requiresName.length} admin surface(s) declared` }
        : { name: "Permission declarations", passed: false, message: problems.join("; ") };
}

function checkHooksEmitted(modulePath: string): CheckResult {
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name: "hooksEmitted", passed: true, message: "No manifest" };
    }

    let manifest: { hooksEmitted?: { hook: string; type: string }[] };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name: "hooksEmitted", passed: true, message: "Manifest unparseable (reported above)" };
    }

    function walkFiles(dir: string): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) results.push(...walkFiles(full));
            else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) results.push(full);
        }
        return results;
    }

    const emitCall = /\b(doAction|doActionAsync|applyFilters|applyFiltersAsync)\(\s*"([^"]+)"/g;
    const found = new Map<string, "action" | "filter">();
    for (const file of walkFiles(modulePath)) {
        const content = fs.readFileSync(file, "utf8");
        for (const m of content.matchAll(emitCall)) {
            found.set(m[2], m[1].includes("Filter") ? "filter" : "action");
        }
    }

    const declared = new Map((manifest.hooksEmitted ?? []).map((h) => [h.hook, h.type]));

    const undeclared = [...found].filter(([hook]) => !declared.has(hook)).map(([hook]) => hook);
    const unused = [...declared.keys()].filter((hook) => !found.has(hook));
    const wrongType = [...found]
        .filter(([hook, type]) => declared.has(hook) && declared.get(hook) !== type)
        .map(([hook, type]) => `${hook} (fired as ${type}, declared as ${declared.get(hook)})`);

    const problems = [
        ...undeclared.map((h) => `fired but not declared: ${h}`),
        ...unused.map((h) => `declared but never fired: ${h}`),
        ...wrongType.map((h) => `type mismatch: ${h}`),
    ];

    if (problems.length > 0) {
        return {
            name: "hooksEmitted",
            passed: false,
            message: `${problems.length} hook declaration problem(s):\n      ${problems.slice(0, 8).join("\n      ")}${problems.length > 8 ? `\n      ... and ${problems.length - 8} more` : ""}`,
            suggestion: 'Every doAction/applyFilters call with a literal name needs a matching { "hook", "type" } entry in the manifest\'s hooksEmitted array, and vice versa.',
        };
    }

    return {
        name: "hooksEmitted",
        passed: true,
        message: found.size === 0 ? "Fires no hooks" : `${found.size} hook(s) fired and declared`,
    };
}

/**
 * Every API handler on disk must be registered, and every admin CRUD screen
 * must be able to reach the endpoints it calls.
 *
 * A `route.ts` under `api/` does nothing on its own: requests arrive through
 * `/api/v1/[...path]`, which only knows the routes the manifest declares. Four
 * modules shipped an `[id]` handler that was never declared, so editing or
 * deleting from their admin screens answered 404, and the vote module pointed
 * its screen at `/api/v1/vote` while declaring `/api/v1/vote/sites`, so
 * creating one did too. Nothing failed at build time and nothing failed in
 * the tests: the screen and the handler were each fine on their own.
 *
 * `AdminCrudPage` lists and creates at `apiPath` and edits and deletes at
 * `apiPath/{id}`, so both have to exist.
 */
/**
 * A module's `statsApi` feeds the admin dashboard and the analytics screen -
 * order counts, revenue, the latest support tickets with the usernames on
 * them. It is admin data by definition, and the route serving it is a plain
 * GET, which `checkApiAuthChecks` above does not look at: that check only
 * asks about writes. Four first-party modules shipped this endpoint open, so
 * anyone could read a shop's daily revenue without logging in.
 */
function checkStatsApiAuth(modulePath: string): CheckResult {
    const name = "Stats API is admin only";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: { statsApi?: string; api?: { path: string; handler: string }[] };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const statsPath = manifest.statsApi;
    if (!statsPath) return { name, passed: true, message: "No stats API declared" };

    const entry = (manifest.api ?? []).find((a) => a.path === statsPath);
    if (!entry) {
        return {
            name,
            passed: false,
            message: `statsApi "${statsPath}" is not one of the module's declared api routes`,
        };
    }

    const handlerPath = path.join(modulePath, entry.handler);
    if (!fs.existsSync(handlerPath)) {
        return { name, passed: false, message: `statsApi handler is missing: ${entry.handler}` };
    }

    const content = fs.readFileSync(handlerPath, "utf8");
    const guarded =
        content.includes("isAdmin(") ||
        content.includes("isStaff(") ||
        content.includes("hasPermission(");
    if (!guarded) {
        return {
            name,
            passed: false,
            message:
                `${entry.handler} serves the admin dashboard but checks nobody - ` +
                `an anonymous GET reads it. Call isAdmin() (or hasPermission()) before answering.`,
        };
    }

    return { name, passed: true, message: `${entry.handler} checks for an admin` };
}

/**
 * Every `t("literal")` a module renders has to exist in the module's own
 * catalogue, in every locale core ships.
 *
 * next-intl does not throw on a missing message: it logs and renders the key
 * path, so the page reads "store.vip_title" where the heading should be. The
 * public VIP page, both store profile tabs and three admin screens shipped
 * that way. A `t.has(key) ? t(key) : "..."` guard is the supported way to
 * ship a key the catalogue may not have, and is not flagged.
 *
 * Only namespaces the module itself declares are checked. A module is free to
 * read a namespace core or another module owns, and those keys are not this
 * module's to declare.
 */
/**
 * A key prefixed `adm_` is the module's promise that only its admin screen
 * renders it, and core takes the module at its word: `publicMessages()` strips
 * every `adm_` key before the catalogue reaches a visitor's browser. A module
 * that renders one outside `pages/admin/` would print the raw key path on a
 * public page.
 *
 * See src/core/lib/i18n/message-scopes.ts for the trim this protects.
 */
function checkAdminKeyPrefix(modulePath: string): CheckResult {
    const name = "adm_ keys stay on admin screens";
    const referencesAdminKey = /['"`]adm_[a-zA-Z0-9_]/;
    const offenders: string[] = [];

    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "admin") continue;
                walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            const source = fs.readFileSync(full, "utf8");
            if (!referencesAdminKey.test(source)) continue;
            /*
             * The trim is on the catalogue handed to the client provider, so
             * the rule is about what a public *client* screen renders. A file
             * that imports a server-only module cannot be one: it would not
             * compile into a browser bundle. The server catalogue is whole, so
             * an admin key resolved there is neither a public screen nor a
             * mistake - a hook assembling an admin panel's words is the case
             * this clause exists for.
             */
            if (/from ["'](?:next-intl\/server|@\/core\/sdk\/server)["']/.test(source)) continue;
            offenders.push(path.relative(modulePath, full));
        }
    };
    walk(modulePath);

    if (offenders.length > 0) {
        return {
            name,
            passed: false,
            message:
                `${offenders.length} file(s) outside pages/admin/ render an adm_ key: ` +
                `${offenders.slice(0, 10).join(", ")}`,
            suggestion:
                "Core strips adm_ keys from the catalogue public pages receive, so these render " +
                "as raw key paths. Rename the key without the prefix, or move the screen under pages/admin/.",
        };
    }

    return { name, passed: true, message: "No adm_ key is rendered outside an admin screen" };
}

function checkTranslationKeys(modulePath: string): CheckResult {
    const name = "Translation keys declared";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: { translations?: Record<string, Record<string, Record<string, string>>> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const translations = manifest.translations;
    if (!translations) return { name, passed: true, message: "No translations declared" };

    // The locales core ships, which are the ones a visitor can actually
    // select. A module may carry more; those are not held to this.
    const coreMessagesDir = path.join(process.cwd(), "messages-core");
    const locales = fs.existsSync(coreMessagesDir)
        ? fs
              .readdirSync(coreMessagesDir)
              .filter((f) => f.endsWith(".json"))
              .map((f) => path.basename(f, ".json"))
        : ["en"];

    // At runtime the catalogue is core merged with the enabled modules, so a
    // key core already owns resolves. `admin` in particular is a shared
    // namespace: a module adds its menu entry to it and reads core's keys out
    // of it.
    const coreMessages: Record<string, Record<string, Record<string, string>>> = {};
    for (const locale of locales) {
        const file = path.join(coreMessagesDir, `${locale}.json`);
        if (!fs.existsSync(file)) continue;
        try {
            coreMessages[locale] = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
            // A broken core catalogue is not this module's problem.
        }
    }

    function walkFiles(dir: string): string[] {
        const results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walkFiles(fullPath));
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                results.push(fullPath);
            }
        }
        return results;
    }

    const violations: string[] = [];

    for (const file of walkFiles(modulePath)) {
        const content = fs.readFileSync(file, "utf8");
        if (!content.includes("Translations(")) continue;

        // const t = useTranslations("ns") / const t = await getTranslations("ns")
        const bindings = new Map<string, string>();
        const bindingPattern =
            /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*["'`]([^"'`]+)["'`]/g;
        for (const match of content.matchAll(bindingPattern)) {
            bindings.set(match[1], match[2]);
        }
        if (bindings.size === 0) continue;

        for (const [binding, namespace] of bindings) {
            // A template literal or a variable is a runtime key; only a
            // literal can be checked here.
            const callPattern = new RegExp(`\\b${binding}\\s*\\(\\s*["'\`]([^"'\`$]+)["'\`]`, "g");
            for (const match of content.matchAll(callPattern)) {
                const key = match[1];
                const guard = new RegExp(
                    `\\b${binding}\\.has\\s*\\(\\s*["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`,
                );
                if (guard.test(content)) continue;

                for (const locale of locales) {
                    const bucket = translations[locale]?.[namespace];
                    // Namespace not this module's: core or another module owns it.
                    if (!bucket) continue;
                    if (coreMessages[locale]?.[namespace]?.[key] !== undefined) continue;
                    if (bucket[key] === undefined) {
                        const where = path.relative(modulePath, file);
                        violations.push(`${where}: ${namespace}.${key} missing from ${locale}`);
                    }
                }
            }
        }
    }

    if (violations.length > 0) {
        return {
            name,
            passed: false,
            message:
                `${violations.length} translation key(s) are rendered but not declared, so the ` +
                `key path shows up in the UI:\n      ` +
                violations.slice(0, 10).join("\n      ") +
                (violations.length > 10 ? `\n      ... and ${violations.length - 10} more` : ""),
            suggestion: "Add the key to translations.<locale>.<namespace> in module.json, or guard the call with t.has().",
        };
    }

    return { name, passed: true, message: "Every rendered key is declared" };
}

/**
 * Every `/api/v1/...` a module's own screens fetch has to be a route that
 * exists.
 *
 * `checkApiRoutesWired` catches an `AdminCrudPage` pointed at an undeclared
 * path, but a component that writes its own `fetch()` had nothing checking it.
 * The blog's comment section fetched `/api/v1/blog/${id}/comments`, which the
 * manifest never declared - the real route is `/blog/comments?articleId=`, so
 * comments silently never loaded and posting one silently 404'd, on a page
 * that looked fine.
 *
 * Only paths under a namespace the module itself owns are checked. Core's
 * endpoints are collected from the filesystem so a module calling one of them
 * is not flagged, and a path under another module's namespace is that module's
 * to declare, not this one's.
 */
function coreApiPaths(): Set<string> {
    const paths = new Set<string>();
    const base = path.join(ROOT, "src/app/api");
    const walk = (dir: string, prefix: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
            } else if (entry.name === "route.ts") {
                paths.add(normalizeApiPath(`/api${prefix}`));
            }
        }
    };
    walk(base, "");
    return paths;
}

/** Collapses every dynamic segment - `[id]`, `[...path]`, `${expr}` - to one placeholder. */
function normalizeApiPath(raw: string): string {
    return raw
        .replace(/\$\{[^}]*\}/g, "[p]")
        .replace(/\[[^\]]+\]/g, "[p]")
        .split("?")[0]
        .replace(/\/+$/, "");
}

/**
 * Reads the string literal opening at `start` and returns its raw text, or
 * null. Handles a template literal whose `${...}` holds quotes of its own,
 * which a regex over the line cannot.
 */
function readStringLiteral(source: string, start: number): string | null {
    const quote = source[start];
    if (quote !== '"' && quote !== "'" && quote !== "`") return null;
    let out = "";
    let depth = 0;
    for (let i = start + 1; i < source.length; i++) {
        const c = source[i];
        if (c === "\\") {
            out += c + (source[i + 1] ?? "");
            i++;
            continue;
        }
        if (quote === "`" && c === "$" && source[i + 1] === "{") {
            depth = 1;
            let expr = "${";
            i += 2;
            for (; i < source.length && depth > 0; i++) {
                if (source[i] === "{") depth++;
                else if (source[i] === "}") depth--;
                if (depth > 0) expr += source[i];
            }
            out += expr + "}";
            i--;
            continue;
        }
        if (c === quote) return out;
        if (c === "\n" && quote !== "`") return null;
        out += c;
    }
    return null;
}

/**
 * A handler that checks a secret the caller supplied has to have a ceiling.
 *
 * `bcrypt.compare` and `verifyToken` both answer "was this guess right?", and
 * an endpoint that answers that without a limit is a guessing loop: the
 * two-factor module's disable, verify and regenerate-codes routes all took an
 * unlimited number of password and TOTP attempts, and the store's gift-code
 * redeem walked a 32-bit code space for credits.
 *
 * The limiter has to be `rateLimitStrict`, not `rateLimitForRole`: role
 * multipliers scale a budget and a multiplier of 0 removes it, which is right
 * for throughput and wrong for a brute-force ceiling.
 */
/**
 * A `providerCallback` endpoint is exempt from the proxy's CSRF origin check,
 * because the service posting to it has no browser and sends no Origin. That
 * exemption is only safe if the handler authenticates the request some other
 * way: a signature it verifies, or reading the payment back from the provider
 * with this site's own credentials.
 *
 * Without this check the flag is a way to punch an unauthenticated hole
 * through the gate, which is the opposite of what it exists for.
 */
/**
 * Every external origin a module loads must be one it declared.
 *
 * Core's CSP allows no third-party host on its own, so an iframe or a script
 * tag pointing at one renders nothing and says so only in the browser console.
 * The Discord widget and the Google Analytics tag both shipped that way for as
 * long as they existed. The declaration is what puts the origin in the policy,
 * so an undeclared one is a feature that cannot work.
 */
function checkCspOriginsDeclared(modulePath: string): CheckResult {
    const name = "External origins are declared for the CSP";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name, passed: true, message: "No manifest to check" };
    }

    let manifest: { csp?: Record<string, string[]> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest is unreadable; another check reports that" };
    }

    const declared = new Set<string>();
    for (const origins of Object.values(manifest.csp ?? {})) {
        if (Array.isArray(origins)) for (const o of origins) declared.add(o);
    }

    const files: string[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) files.push(full);
        }
    };
    walk(modulePath);

    // Only the two directives a missing origin renders as "nothing happened":
    // a blocked frame and a blocked script. Fetches ride core's `https:`.
    const patterns = [
        /<iframe[\s\S]{0,400}?src=\{?[`"']([^`"'{$]*https:\/\/[^`"'/]+)/g,
        /<[Ss]cript[\s\S]{0,300}?src=\{?[`"']([^`"'{$]*https:\/\/[^`"'/]+)/g,
    ];
    const undeclared = new Set<string>();
    for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        for (const pattern of patterns) {
            for (const match of source.matchAll(pattern)) {
                const url = match[1].replace(/^.*?(https:\/\/)/, "$1");
                let origin: string;
                try {
                    origin = new URL(url).origin;
                } catch {
                    continue;
                }
                if (!declared.has(origin)) undeclared.add(origin);
            }
        }
    }

    if (undeclared.size > 0) {
        return {
            name,
            passed: false,
            message: `${undeclared.size} origin(s) loaded but not declared: ${[...undeclared].join(", ")}`,
            suggestion:
                'Add them to the manifest, e.g. "csp": { "frame-src": ["https://discord.com"] }. ' +
                "Core's policy allows no third-party origin, so an undeclared one is blocked in the browser.",
        };
    }

    return {
        name,
        passed: true,
        message: declared.size > 0 ? `${declared.size} declared origin(s)` : "Loads no external origin",
    };
}

function checkProviderCallbacksVerify(modulePath: string): CheckResult {
    const name = "Provider callbacks authenticate themselves";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name, passed: true, message: "No manifest to check" };
    }

    let manifest: { api?: Array<{ path: string; handler: string; method?: string; providerCallback?: boolean }> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest is unreadable; another check reports that" };
    }

    const declared = (manifest.api ?? []).filter((entry) => entry.providerCallback);
    if (declared.length === 0) {
        return { name, passed: true, message: "Declares no provider callback" };
    }

    // The exemption is generated into a regex the proxy tests every API path
    // against. A path whose first segment is dynamic produces one that matches
    // sibling routes it has nothing to do with: `/[provider]` becomes
    // `/^\/api\/v1\/[^\/]+\/?$/` and answers for `/api/v1/roles`. A webhook
    // lives at a URL the module tells the provider, so that first segment is
    // always something the module chose and can write down.
    const wildcardFirst = declared
        .filter((entry) => /^\/?\[/.test(entry.path))
        .map((entry) => entry.path);
    if (wildcardFirst.length > 0) {
        return {
            name,
            passed: false,
            message: `${wildcardFirst.length} provider callback(s) start with a dynamic segment, so the CSRF exemption they generate covers routes they do not own: ${wildcardFirst.join(", ")}`,
            suggestion:
                "Give the callback a literal first segment, for example /webhooks/[provider] rather than /[provider]. " +
                "The exemption is then scoped to the path the module actually serves.",
        };
    }

    // Either a signature comparison, or the documented pattern of reading the
    // payment back from the provider instead of trusting the post.
    const verifies = /timingSafeEqual|constructEvent|verifyWebhookSignature|@provider-callback/;
    const offenders: string[] = [];
    for (const entry of declared) {
        const handler = path.join(modulePath, entry.handler);
        if (!fs.existsSync(handler)) {
            offenders.push(`${entry.path} (handler missing)`);
            continue;
        }
        if (!verifies.test(fs.readFileSync(handler, "utf8"))) {
            offenders.push(entry.path);
        }
    }

    if (offenders.length > 0) {
        return {
            name,
            passed: false,
            message: `${offenders.length} provider callback(s) skip the CSRF gate without authenticating: ${offenders.join(", ")}`,
            suggestion:
                "Verify the provider's signature with crypto.timingSafeEqual (or the SDK's own verifier), or read the " +
                "payment back from the provider with this site's credentials and document that with a @provider-callback " +
                "comment. Drop providerCallback if the endpoint does not need the exemption.",
        };
    }

    return { name, passed: true, message: `${declared.length} provider callback(s) authenticate themselves` };
}

function checkTitleFromPathIsEarned(modulePath: string): CheckResult {
    const name = "Routes titled from the URL resolve on the server";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name, passed: true, message: "No manifest to check" };
    }

    let manifest: { routes?: Array<{ path: string; component: string; titleFromPath?: boolean }> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest is unreadable; another check reports that" };
    }

    const declared = (manifest.routes ?? []).filter((route) => route.titleFromPath);
    if (declared.length === 0) {
        return { name, passed: true, message: "No route titles itself from the URL" };
    }

    // `titleFromPath` tells core the last URL segment names something real, so
    // core puts it in <title>, og:title and twitter:title. That only holds if a
    // URL naming nothing answers 404, which needs the lookup to happen on the
    // server: a client page that fetches and then renders "not found" has
    // already sent a 200 with the visitor's own text as the page title, and an
    // unfurled link in chat shows it under the site's name.
    const offenders: string[] = [];
    for (const route of declared) {
        const component = path.join(modulePath, route.component);
        if (!fs.existsSync(component)) {
            offenders.push(`${route.path} (component missing)`);
            continue;
        }
        const body = fs.readFileSync(component, "utf8");
        if (/^\s*["']use client["']/m.test(body)) {
            offenders.push(`${route.path} (client component)`);
        } else if (!/\bnotFound\s*\(\s*\)/.test(body)) {
            offenders.push(`${route.path} (never calls notFound)`);
        }
    }

    if (offenders.length > 0) {
        return {
            name,
            passed: false,
            message: `${offenders.length} route(s) claim titleFromPath without 404ing on the server: ${offenders.join(", ")}`,
            suggestion:
                "Resolve the resource in a server component and call notFound() when there is none, or drop " +
                "titleFromPath and let core title the page from the route you declared.",
        };
    }

    return { name, passed: true, message: `${declared.length} route(s) earn their path-derived title` };
}

/**
 * A dynamic public route has to answer 404 when its URL names nothing.
 *
 * Either the page is a server component that looks the subject up and calls
 * `notFound()`, or the manifest names a `resolver` and core's catch-all asks
 * before rendering. A page that fetches in the browser and then draws "not
 * found" has already sent a 200: search engines index it, link checkers walk
 * past it, and a monitor watching for a status sees a healthy page.
 */
function checkDynamicRoutes404(modulePath: string): CheckResult {
    const name = "Dynamic routes 404";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name, passed: true, message: "No manifest to check" };
    }

    let manifest: { routes?: Array<{ path: string; component: string; resolver?: string }> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest is unreadable; another check reports that" };
    }

    const dynamic = (manifest.routes ?? []).filter((route) => route.path.includes("["));
    if (dynamic.length === 0) {
        return { name, passed: true, message: "No dynamic public routes" };
    }

    const offenders: string[] = [];
    for (const route of dynamic) {
        if (route.resolver) continue;
        const component = path.join(modulePath, route.component);
        if (!fs.existsSync(component)) {
            offenders.push(`${route.path} (component missing)`);
            continue;
        }
        const body = fs.readFileSync(component, "utf8");
        const isClient = /^\s*["']use client["']/m.test(body);
        if (isClient || !/\bnotFound\s*\(\s*\)/.test(body)) {
            offenders.push(route.path);
        }
    }

    if (offenders.length > 0) {
        return {
            name,
            passed: false,
            message: `${offenders.length} dynamic route(s) answer 200 for a URL that names nothing: ${offenders.join(", ")}`,
            suggestion:
                "Add a `resolver` to the route in module.json - a file default-exporting " +
                "`(params) => Promise<boolean>` - or resolve on the server and call notFound().",
        };
    }

    return { name, passed: true, message: `${dynamic.length} dynamic route(s) answer 404 properly` };
}

/**
 * Find each `prisma.setting.upsert(...)` / `.create(...)` call and return the
 * source of its argument, by counting brackets from the opening paren.
 */
function settingWriteCalls(body: string): string[] {
    const out: string[] = [];
    const re = /prisma\.setting\.(?:upsert|create|createMany)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        let depth = 0;
        let i = m.index + m[0].length - 1;
        const start = i;
        for (; i < body.length; i++) {
            const c = body[i];
            if (c === "(" || c === "{" || c === "[") depth++;
            else if (c === ")" || c === "}" || c === "]") {
                depth--;
                if (depth === 0) break;
            }
        }
        out.push(body.slice(start, i + 1));
    }
    return out;
}

function checkSettingsAreOwned(modulePath: string): CheckResult {
    const name = "Settings rows name their module";
    const offenders: string[] = [];

    const files: string[] = [];
    (function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules") continue;
                walk(full);
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                files.push(full);
            }
        }
    })(modulePath);

    for (const file of files) {
        const body = fs.readFileSync(file, "utf8");
        for (const call of settingWriteCalls(body)) {
            // `update` never needs it: the row already exists and keeps the
            // owner it was created with.
            if (!/\bcreate\s*:/.test(call) && !/\bdata\s*:/.test(call)) continue;
            if (/\bmodule\s*:/.test(call)) continue;
            offenders.push(path.relative(modulePath, file).replace(/\\/g, "/"));
        }
    }

    if (offenders.length > 0) {
        const unique = [...new Set(offenders)];
        return {
            name,
            passed: false,
            message: `${offenders.length} Setting write(s) do not say which module owns the row: ${unique.join(", ")}`,
            suggestion:
                'Add `module: "<module id>"` to the create half of the write. Uninstall deletes a module\'s settings by ' +
                'that column, so an untagged row defaults to "core" and outlives the module that made it, credentials ' +
                'included. Use `module: "core"` only for a key the module writes on core\'s behalf.',
        };
    }

    return { name, passed: true, message: "Every Setting write names an owner" };
}

function checkDeclaredSettingsAreRead(modulePath: string): CheckResult {
    const name = "Declared settings are read";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) {
        return { name, passed: true, message: "No manifest to check" };
    }

    let manifest: { settings?: { key: string }[] };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest is unparseable - covered by another check" };
    }

    const declared = manifest.settings ?? [];
    if (declared.length === 0) {
        return { name, passed: true, message: "No settings declared" };
    }

    const sources: string[] = [];
    (function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules") continue;
                walk(full);
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                sources.push(fs.readFileSync(full, "utf8"));
            }
        }
    })(modulePath);

    const body = sources.join("\n");
    const unread = declared
        .map((setting) => setting.key)
        .filter((key) => !new RegExp(`\\b${key}\\b`).test(body));

    if (unread.length > 0) {
        return {
            name,
            passed: false,
            message: `${unread.length} declared setting(s) are never read: ${unread.join(", ")}`,
            suggestion:
                "Read it with `moduleSettings(\"<module id>\")` from @/core/sdk/server, or delete the declaration. " +
                "A setting an admin can change and the module never consults is worse than no setting: it reads as a " +
                "control that works. Five modules once declared sixteen of them and not one was read anywhere.",
        };
    }

    return { name, passed: true, message: `All ${declared.length} declared setting(s) are read` };
}

function checkNoMassAssignment(modulePath: string): CheckResult {
    const name = "Request bodies are filtered before a write";
    const offenders: string[] = [];

    const files: string[] = [];
    (function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules") continue;
                walk(full);
            } else if (entry.name === "route.ts") {
                files.push(full);
            }
        }
    })(modulePath);

    for (const file of files) {
        const body = fs.readFileSync(file, "utf8");

        // Names holding the parsed request body, and anything spread from one.
        const names = new Set(
            [...body.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:readJsonBody|request\.json|req\.json)\(/g)]
                .map((m) => m[1]),
        );
        if (names.size === 0) continue;
        for (let pass = 0; pass < 3; pass++) {
            for (const m of body.matchAll(/(?:const|let)\s+(\w+)(?::[^=]+)?\s*=\s*\{\s*\.\.\.\s*(\w+)/g)) {
                if (names.has(m[2])) names.add(m[1]);
            }
        }

        const rel = path.relative(modulePath, file).replace(/\\/g, "/");
        for (const m of body.matchAll(/data:\s*(?:\{\s*\.\.\.\s*)?(\w+)\s*[,}]/g)) {
            if (names.has(m[1])) {
                offenders.push(`${rel} (data: ${m[1]})`);
            }
        }
    }

    if (offenders.length > 0) {
        return {
            name,
            passed: false,
            message: `${offenders.length} Prisma write(s) receive the request body unfiltered: ${[...new Set(offenders)].join(", ")}`,
            suggestion:
                "Parse the body with a schema that names the fields the endpoint means to accept, and write the parsed " +
                "result. Handing the raw body to Prisma lets a caller set any column on the model, skips whatever bounds " +
                "the matching create enforces, and answers 500 on a key the model does not have.",
        };
    }

    return { name, passed: true, message: "No write takes an unfiltered body" };
}

function checkSecretChecksLimited(modulePath: string): CheckResult {
    const name = "Secret checks are rate limited";
    const comparesSecret = /bcrypt\.compare\(|verifyToken\(/;
    const offenders: string[] = [];

    const apiDir = path.join(modulePath, "api");
    (function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (entry.name !== "route.ts") continue;
            const content = fs.readFileSync(full, "utf8");
            if (!comparesSecret.test(content)) continue;
            if (content.includes("rateLimitStrict(")) continue;
            offenders.push(path.relative(modulePath, full).replace(/\\/g, "/"));
        }
    })(apiDir);

    if (offenders.length > 0) {
        return {
            name,
            passed: false,
            message: `${offenders.length} handler(s) check a secret with no ceiling: ${offenders.join(", ")}`,
            suggestion:
                "Call rateLimitStrict() before comparing the secret. rateLimitForRole is the wrong tool here: " +
                "a role multiplier of 0 lifts the limit entirely, and a brute-force ceiling has to hold for every role.",
        };
    }

    return { name, passed: true, message: "Every secret check has a ceiling" };
}

/**
 * Aliases of one handler have to agree about their limit.
 *
 * A manifest may declare the same handler at more than one path, and the
 * dispatcher now counts a caller's requests against the handler rather than
 * the URL so the aliases share one budget. That only stays honest while the
 * declarations agree: if one spelling asks for a tighter `rateLimit` and
 * another leaves it off, a caller who picks the loose spelling gets the loose
 * ceiling on a bucket the tight one was meant to guard. Same for
 * `providerCallback`, which buys a far higher ceiling.
 */
function checkApiAliasesAgree(modulePath: string): CheckResult {
    const name = "API aliases agree on their limit";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: { api?: Array<{ path: string; handler: string; method?: string; providerCallback?: boolean; rateLimit?: { maxRequests: number; windowMs: number } }> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const api = manifest.api ?? [];
    if (api.length === 0) return { name, passed: true, message: "Declares no API routes" };

    const byHandler = new Map<string, typeof api>();
    for (const route of api) {
        const handler = (route.handler ?? "").replace(/^\.?\//, "");
        if (!handler) continue;
        const list = byHandler.get(handler) ?? [];
        list.push(route);
        byHandler.set(handler, list);
    }

    const shape = (r: (typeof api)[number]) =>
        JSON.stringify({
            method: r.method ?? "ALL",
            providerCallback: r.providerCallback ?? false,
            rateLimit: r.rateLimit ?? null,
        });

    const problems: string[] = [];
    for (const [handler, routes] of byHandler) {
        if (routes.length < 2) continue;
        const shapes = new Set(routes.map(shape));
        if (shapes.size === 1) continue;
        problems.push(`${handler} is declared at ${routes.map((r) => r.path).join(" and ")} with different method/rateLimit/providerCallback`);
    }

    if (problems.length > 0) {
        return {
            name,
            passed: false,
            message: `${problems.length} disagreeing alias(es):\n      ${problems.join("\n      ")}`,
            suggestion: "Give every path that names the same handler the same method, rateLimit and providerCallback, or point them at separate handlers.",
        };
    }
    const aliased = [...byHandler.values()].filter((r) => r.length > 1).length;
    return { name, passed: true, message: aliased === 0 ? "No handler is aliased" : `${aliased} aliased handler(s) agree` };
}

/**
 * A user table has to say what the right to be forgotten does with it.
 *
 * Core used to hold the list, naming six tables belonging to five modules,
 * so a module core had never been edited for could not have its private data
 * erased at all. The disposition now lives with the module. Omitting it is
 * legal and means "retain", which is what an undeclared table always did, but
 * a module that ships user tables should have made the choice on purpose.
 */
function checkErasureIsDeclared(modulePath: string): CheckResult {
    const name = "User tables state their erasure";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: { userDataExport?: Array<{ model: string; column: string; erasure?: string }> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const tables = manifest.userDataExport ?? [];
    if (tables.length === 0) return { name, passed: true, message: "Declares no user tables" };

    const silent = tables
        .filter((t) => t.erasure !== "purge" && t.erasure !== "retain")
        .map((t) => t.model);
    if (silent.length > 0) {
        return {
            name,
            passed: false,
            message: `${silent.length} table(s) with no erasure: ${silent.join(", ")}`,
            suggestion: 'Add "erasure": "purge" for private data the user can ask to have deleted, or "retain" for anything with public-record or moderation value.',
        };
    }

    const schemaPath = path.join(modulePath, "schema.prisma");
    const schema = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, "utf8") : "";
    const problems: string[] = [];
    for (const table of tables) {
        if (table.erasure !== "purge") continue;
        const model = table.model[0].toUpperCase() + table.model.slice(1);
        const match = new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(schema);
        if (!match) {
            problems.push(`${table.model} is purged but is not in this module's schema.prisma`);
        } else if (!new RegExp(`^\\s*${table.column}\\s+\\S`, "m").test(match[1])) {
            problems.push(`${table.model} is purged on ${table.column}, which it has no column for`);
        }
    }
    if (problems.length > 0) {
        return {
            name,
            passed: false,
            message: `${problems.length} problem(s):\n      ${problems.join("\n      ")}`,
            suggestion: "A purge runs deleteMany on that model and column; both have to exist or the erasure silently deletes nothing.",
        };
    }

    const purged = tables.filter((t) => t.erasure === "purge").length;
    return { name, passed: true, message: `${tables.length} table(s), ${purged} purged on erasure` };
}

/**
 * A page core renders for a module has to be named in the visitor's language.
 *
 * A module page is a component in a registry, not a route segment file, so it
 * cannot export `generateMetadata` and core titles it. Core built that title
 * from the route pattern, which is a URL and is therefore written once, in
 * English: a Turkish visitor reading "Mağaza" under the heading had "Store"
 * in the browser tab and in the search result, and `/store/vip` was titled
 * "Vip", which is not a word in either language. A route now declares
 * `titleKey`, and it has to resolve in every locale the module ships.
 */
/**
 * A route claiming to serve profiles has to be able to name one person.
 *
 * Core writes a username in the activity feed and the audit log and asks the
 * registry where it points. A `userProfile` route with no dynamic segment
 * would send every person to the same page; one with two would leave a
 * literal `[something]` in the URL. Both are worse than not linking at all,
 * which is what core does when no module claims the capability.
 */
function checkUserProfileRoute(modulePath: string): CheckResult {
    const name = "User profile route names one person";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: { routes?: Array<{ path: string; userProfile?: boolean; resolver?: string }> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const claimed = (manifest.routes ?? []).filter((r) => r.userProfile);
    if (claimed.length === 0) return { name, passed: true, message: "Claims no profile route" };

    const problems: string[] = [];
    if (claimed.length > 1) {
        problems.push(`${claimed.length} routes claim userProfile; a module serves profiles at one path`);
    }
    for (const route of claimed) {
        const dynamic = route.path.match(/\[[^\]]+\]/g) ?? [];
        if (dynamic.length !== 1) {
            problems.push(`${route.path} has ${dynamic.length} dynamic segments, needs exactly 1 (the username)`);
        } else if (dynamic[0].startsWith("[...")) {
            problems.push(`${route.path} is a catch-all; a profile route takes one username`);
        }
        if (!route.resolver) {
            // A profile page that answers 200 for a name nobody has is a soft
            // 404, and core links to this path from its own pages.
            problems.push(`${route.path} needs a resolver so an unknown username answers 404`);
        }
    }

    return problems.length === 0
        ? { name, passed: true, message: `${claimed[0].path} serves profiles` }
        : { name, passed: false, message: problems.join("; ") };
}

function checkRouteTitlesAreTranslated(modulePath: string): CheckResult {
    const name = "Route titles are translated";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: {
        routes?: Array<{ path: string; titleKey?: string; titleFromPath?: boolean }>;
        translations?: Record<string, Record<string, Record<string, string>>>;
    };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const routes = manifest.routes ?? [];
    if (routes.length === 0) return { name, passed: true, message: "Renders no pages" };

    const locales = Object.keys(manifest.translations ?? {});
    const problems: string[] = [];
    for (const route of routes) {
        if (!route.titleKey) {
            // `titleFromPath` names the page from the resource the URL
            // identifies, which is the resource's own words already.
            if (route.titleFromPath) continue;
            problems.push(`${route.path} has no titleKey`);
            continue;
        }
        const [namespace, ...rest] = route.titleKey.split(".");
        const key = rest.join(".");
        for (const locale of locales) {
            const value = manifest.translations?.[locale]?.[namespace]?.[key];
            if (typeof value !== "string" || !value.trim()) {
                problems.push(`${route.path}: ${route.titleKey} missing for ${locale}`);
            }
        }
    }

    if (problems.length > 0) {
        return {
            name,
            passed: false,
            message: `${problems.length} problem(s):\n      ${problems.join("\n      ")}`,
            suggestion: 'Give each route a "titleKey" of the form "namespace.key" and ship that key in every locale, or set "titleFromPath" where the URL names the resource itself.',
        };
    }
    return { name, passed: true, message: `${routes.length} page(s) named in ${locales.length} locale(s)` };
}

/**
 * A page core renders itself is not a page a module can render.
 *
 * Module pages are served by three catch-alls - `[locale]/[...slug]`,
 * `[locale]/(admin)/admin/[...slug]` and `api/v1/[...path]` - and a catch-all
 * is the lowest-priority match in the App Router. A core file at the same
 * depth with the same literal segments therefore answers the URL first, and
 * the module's page is simply never reached: no error, no log line, and the
 * sidebar link the module contributed still points at it.
 *
 * `seo` shipped that way. It declared the admin route `/seo`, core carried a
 * dead screen at `src/app/[locale]/(admin)/admin/seo/page.tsx`, and installing
 * SEO Manager put a working link in the sidebar that landed on core's stub.
 */
function checkRoutesAreNotShadowed(modulePath: string): CheckResult {
    const name = "Routes are not shadowed by core";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: {
        routes?: { path: string }[];
        adminRoutes?: { path: string }[];
        api?: { path: string }[];
    };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const declared: { kind: string; url: string }[] = [
        ...(manifest.routes ?? []).map((r) => ({ kind: "route", url: r.path })),
        ...(manifest.adminRoutes ?? []).map((r) => ({ kind: "adminRoute", url: `/admin${r.path}` })),
        ...(manifest.api ?? []).map((r) => ({ kind: "api", url: `/api/v1${r.path}` })),
    ];
    if (declared.length === 0) return { name, passed: true, message: "Declares no routes" };

    const core = coreRouteUrls();
    const problems: string[] = [];
    for (const { kind, url } of declared) {
        const owner = core.find((c) => shadows(c.url, url));
        if (owner) problems.push(`${kind} ${url} is answered by ${owner.file}`);
    }

    if (problems.length > 0) {
        return {
            name,
            passed: false,
            message: `${problems.length} shadowed route(s):\n      ${problems.join("\n      ")}`,
            suggestion: "Pick a path core does not already render, or delete the core page if the module is meant to replace it.",
        };
    }
    return { name, passed: true, message: `${declared.length} route(s) reach the module` };
}

/**
 * Every URL core answers with a file of its own, catch-alls excluded: those
 * are the dispatchers that serve modules, not competitors for a path.
 */
function coreRouteUrls(): { url: string; file: string }[] {
    const out: { url: string; file: string }[] = [];
    const collect = (base: string, prefix: string, leaf: string) => {
        const walk = (dir: string, url: string) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            if (entries.some((e) => e.isFile() && e.name === leaf)) {
                out.push({ url: url || "/", file: path.relative(ROOT, path.join(dir, leaf)) });
            }
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                // A route group - `(admin)` - names no URL segment.
                const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
                const segment = grouped ? "" : `/${entry.name}`;
                if (/^\[\[?\.\.\./.test(entry.name)) continue;
                walk(path.join(dir, entry.name), url + segment);
            }
        };
        walk(path.join(ROOT, base), prefix);
    };
    collect("src/app/[locale]", "", "page.tsx");
    collect("src/app/api/v1", "/api/v1", "route.ts");
    return out;
}

/** True when a core URL answers a module URL: same depth, segment by segment. */
function shadows(coreUrl: string, moduleUrl: string): boolean {
    const a = coreUrl.split("/").filter(Boolean);
    const b = moduleUrl.split("/").filter(Boolean);
    if (a.length !== b.length) return false;
    // A dynamic core segment still outranks a catch-all, so it shadows too.
    return a.every((seg, i) => seg.startsWith("[") || seg === b[i]);
}

function checkModuleFetchPaths(modulePath: string): CheckResult {
    const name = "Fetched API paths exist";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: { api?: { path: string; handler: string }[] };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const api = manifest.api ?? [];
    if (api.length === 0) return { name, passed: true, message: "Declares no API routes" };

    const declared = new Set(api.map((a) => normalizeApiPath(`/api/v1${a.path}`)));
    const owned = new Set(api.map((a) => a.path.split("/")[1]).filter(Boolean));
    const core = coreApiPaths();

    const files: string[] = [];
    (function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules") continue;
                walk(full);
            } else if (/\.tsx?$/.test(entry.name) && entry.name !== "route.ts") {
                files.push(full);
            }
        }
    })(modulePath);

    const problems: string[] = [];
    for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        const where = path.relative(modulePath, file).replace(/\\/g, "/");
        for (const match of source.matchAll(/fetch\(\s*/g)) {
            const start = (match.index ?? 0) + match[0].length;
            const raw = readStringLiteral(source, start);
            if (!raw || !raw.includes("/api/v1/")) continue;
            const tail = raw.slice(raw.indexOf("/api/v1/") + "/api/v1/".length);
            const namespace = tail.split("/")[0].split("?")[0];
            if (!owned.has(namespace)) continue;
            const written = raw.slice(raw.indexOf("/api/v1"));
            const normalized = normalizeApiPath(written);
            if (declared.has(normalized) || core.has(normalized)) continue;
            // An interpolation glued to the end of the path is usually a query
            // string the route does declare - `/licenses/admin${q ? "?q=..." : ""}`.
            // Accept it when everything written before the interpolation is
            // itself a whole declared route.
            const literalPrefix = written.split("${")[0].replace(/\/+$/, "");
            if (declared.has(literalPrefix) || core.has(literalPrefix)) continue;
            const line = source.slice(0, match.index).split("\n").length;
            problems.push(`${where}:${line}: fetches ${raw} - no such route`);
        }
    }

    if (problems.length > 0) {
        return {
            name,
            passed: false,
            message: `${problems.length} unrouted fetch(es):\n      ${problems.slice(0, 8).join("\n      ")}`,
            suggestion:
                "The dispatcher answers only the paths the manifest declares, so a fetch to any other " +
                "path 404s at runtime with nothing at build time to say so. Fix the path, or declare the route.",
        };
    }

    return { name, passed: true, message: `${files.length} file(s) fetch only declared routes` };
}

/**
 * A component under a capability directory is declared, or it is dead.
 *
 * `widgets/` and `slots/` are not ordinary source folders: core renders what
 * the manifest names there and nothing else, resolving the export by the id it
 * was given. Two finished widgets sat in `store/widgets/` for their whole life
 * without an entry - a payment goal bar and a top credit loaders list, both
 * translated into every locale the module ships, both reading endpoints that
 * answer - and the homepage they were written for never knew about them.
 *
 * A file that another file in the module imports is a helper and passes; only
 * something nothing names at all is dead.
 */
function checkCapabilityFilesDeclared(modulePath: string): CheckResult {
    const name = "Capability components are declared";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };
    const manifest = fs.readFileSync(manifestPath, "utf8");

    const imported = new Set<string>();
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
            } else if (/\.tsx?$/.test(entry.name)) {
                const source = fs.readFileSync(full, "utf8");
                for (const match of source.matchAll(/(?:from|import\(\s*)\s*["'`](\.[^"'`]+)["'`]/g)) {
                    imported.add(path.normalize(path.join(path.dirname(full), match[1])));
                }
            }
        }
    };
    walk(modulePath);

    const orphans: string[] = [];
    for (const dir of ["widgets", "slots"]) {
        const full = path.join(modulePath, dir);
        if (!fs.existsSync(full)) continue;
        for (const entry of fs.readdirSync(full)) {
            if (!/\.tsx?$/.test(entry)) continue;
            const stem = entry.replace(/\.tsx?$/, "");
            if (manifest.includes(`${dir}/${stem}`)) continue;
            if (imported.has(path.join(full, stem))) continue;
            orphans.push(`${dir}/${entry}`);
        }
    }

    if (orphans.length > 0) {
        return {
            name,
            passed: false,
            message: `${orphans.length} component(s) under a capability directory that the manifest never names: ${orphans.join(", ")}`,
            suggestion:
                "Core renders only what the manifest declares, so these never reach a page. Add an entry " +
                "naming the file and the exported component, or delete the file.",
        };
    }

    return { name, passed: true, message: "Every widget and slot component is declared" };
}

function checkApiRoutesWired(modulePath: string): CheckResult {
    const name = "API routes wired";
    const manifestPath = path.join(modulePath, "module.json");
    if (!fs.existsSync(manifestPath)) return { name, passed: true, message: "No manifest" };

    let manifest: { api?: { path: string; handler: string }[] };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return { name, passed: true, message: "Manifest unparseable (reported above)" };
    }

    const api = manifest.api ?? [];
    const declaredHandlers = new Set(api.map((a) => a.handler.replace(/\\/g, "/")));
    const declaredPaths = api.map((a) => `/api/v1${a.path}`);
    const problems: string[] = [];

    // 1. Handlers on disk that nothing routes to.
    const apiDir = path.join(modulePath, "api");
    const onDisk: string[] = [];
    (function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === "route.ts") onDisk.push(path.relative(modulePath, full).replace(/\\/g, "/"));
        }
    })(apiDir);
    for (const handler of onDisk) {
        if (!declaredHandlers.has(handler)) problems.push(`handler never registered: ${handler}`);
    }

    // 2. Admin CRUD screens whose endpoints are not declared.
    const screens: string[] = [];
    (function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".tsx")) screens.push(full);
        }
    })(path.join(modulePath, "pages"));

    for (const file of screens) {
        const content = fs.readFileSync(file, "utf8");
        if (!content.includes("AdminCrudPage")) continue;
        const match = /apiPath=["']([^"']+)["']/.exec(content);
        if (!match) continue;
        const apiPath = match[1];
        const where = path.relative(modulePath, file).replace(/\\/g, "/");
        if (!declaredPaths.includes(apiPath)) {
            problems.push(`${where}: apiPath ${apiPath} is not a declared route`);
        }
        const hasItemRoute = declaredPaths.some((d) => {
            if (!d.startsWith(`${apiPath}/`)) return false;
            return /^\[[^\]]+\]$/.test(d.slice(apiPath.length + 1));
        });
        if (!hasItemRoute) {
            problems.push(`${where}: no declared route for ${apiPath}/[id] - edit and delete would 404`);
        }
    }

    if (problems.length > 0) {
        return {
            name,
            passed: false,
            message: `${problems.length} routing problem(s):\n      ${problems.slice(0, 8).join("\n      ")}${problems.length > 8 ? `\n      ... and ${problems.length - 8} more` : ""}`,
            suggestion: 'Every api/**/route.ts needs an { "path", "handler" } entry in the manifest, and an AdminCrudPage needs both its collection route and its [id] route declared.',
        };
    }

    return {
        name,
        passed: true,
        message: onDisk.length === 0 ? "Ships no API routes" : `${onDisk.length} handler(s) registered`,
    };
}

/**
 * Run every check against one module. Returns the failures, if any.
 *
 * `withTypeScript` exists because `checkTypeScript` shells out to a full
 * `tsc --noEmit` over the whole project and then filters the output down to
 * this module's files. That is tolerable for one module - a third-party author
 * running the command once - but `--all` would pay it 42 times over. In that
 * mode `npm run typecheck:modules` is the check that actually covers the tree,
 * and it does so against a Prisma client that has the module models in it,
 * which this one does not.
 */
function validateOne(modulePath: string, verbose: boolean, withTypeScript = true): CheckResult[] {
    const moduleName = path.basename(modulePath);

    if (verbose) {
        console.log(`\nValidating module: ${moduleName}`);
        console.log(`Path: ${modulePath}`);
        console.log("─".repeat(60));
    }

    const checks: CheckResult[] = [
        checkManifestExists(modulePath),
        checkRequiredFields(modulePath),
        checkIdFormat(modulePath),
        checkManifestSchema(modulePath),
        checkReferencedFiles(modulePath),
        checkNoCoreImports(modulePath),
        checkSdkImports(modulePath),
        checkSchemaPrisma(modulePath),
        ...(withTypeScript
            ? [checkTypeScript(modulePath)]
            : [
                  {
                      name: "TypeScript compilation",
                      passed: true,
                      message: "Skipped - covered by `npm run typecheck:modules`",
                  },
              ]),
        checkNoAnyTypes(modulePath),
        checkApiAuthChecks(modulePath),
        checkPermissionsDeclared(modulePath),
        checkApiRoutesWired(modulePath),
        checkCapabilityFilesDeclared(modulePath),
        checkStatsApiAuth(modulePath),
        checkTranslationKeys(modulePath),
        checkAdminKeyPrefix(modulePath),
        checkModuleFetchPaths(modulePath),
        checkApiAliasesAgree(modulePath),
        checkErasureIsDeclared(modulePath),
        checkRouteTitlesAreTranslated(modulePath),
        checkRoutesAreNotShadowed(modulePath),
        checkUserProfileRoute(modulePath),
        checkSecretChecksLimited(modulePath),
        checkProviderCallbacksVerify(modulePath),
        checkTitleFromPathIsEarned(modulePath),
        checkDynamicRoutes404(modulePath),
        checkSettingsAreOwned(modulePath),
        checkDeclaredSettingsAreRead(modulePath),
        checkNoMassAssignment(modulePath),
        checkCspOriginsDeclared(modulePath),
        checkHooksEmitted(modulePath),
    ];

    if (verbose) {
        for (const check of checks) {
            console.log(`\n  [${check.passed ? "PASS" : "FAIL"}] ${check.name}`);
            console.log(`      ${check.message}`);
            if (!check.passed && check.suggestion) {
                console.log(`      Suggestion: ${check.suggestion}`);
            }
        }

        const failed = checks.filter((c) => !c.passed).length;
        console.log("\n" + "─".repeat(60));
        console.log(`Results: ${checks.length - failed} passed, ${failed} failed out of ${checks.length} checks`);
        console.log(failed > 0 ? "\nFix the issues above and run validation again." : "\nAll checks passed!");
    }

    return checks.filter((c) => !c.passed);
}

function main(): void {
    const args = process.argv.slice(2);

    // `--all` walks module-sources/ in one process. Spawning tsx per module
    // costs ~3s of startup each, which is why CI needs this rather than a
    // shell loop.
    if (args[0] === "--all") {
        const sources = path.join(ROOT, "module-sources");
        const modules = fs
            .readdirSync(sources, { withFileTypes: true })
            .filter((e) => e.isDirectory() && fs.existsSync(path.join(sources, e.name, "module.json")))
            .map((e) => e.name)
            .sort();

        const broken = new Map<string, CheckResult[]>();
        for (const name of modules) {
            const failures = validateOne(path.join(sources, name), false, false);
            if (failures.length > 0) broken.set(name, failures);
            console.log(`  [${failures.length === 0 ? "PASS" : "FAIL"}] ${name}`);
        }

        if (broken.size > 0) {
            console.error(`\n${broken.size} of ${modules.length} module(s) failed validation:\n`);
            for (const [name, failures] of broken) {
                console.error(`  ${name}`);
                for (const f of failures) {
                    console.error(`    - ${f.name}: ${f.message.split("\n")[0]}`);
                    if (f.suggestion) console.error(`      ${f.suggestion}`);
                }
            }
            process.exit(1);
        }

        console.log(`\n${modules.length} module(s) validated, 0 failures.`);
        return;
    }

    if (args.length === 0) {
        usage();
    }

    const modulePath = path.resolve(ROOT, args[0]);

    if (!fs.existsSync(modulePath)) {
        console.error(`Error: Module path not found: ${modulePath}`);
        process.exit(1);
    }

    if (!fs.statSync(modulePath).isDirectory()) {
        console.error(`Error: Not a directory: ${modulePath}`);
        process.exit(1);
    }

    if (validateOne(modulePath, true).length > 0) process.exit(1);
}

main();
