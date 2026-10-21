/**
 * Merge `prisma/schema.core.prisma` with the per-module `schema.prisma` files.
 *
 * Two callers want different module sets and must not be confused:
 *
 *  - `scripts/merge-schemas.ts` builds the schema the app actually runs on, so
 *    it takes only INSTALLED modules (`src/modules/`). Shipping models for a
 *    module nobody installed would create tables the app never reads.
 *  - `scripts/typecheck-modules.ts` type-checks all of `module-sources/`, so it
 *    needs every module's models present at once - otherwise every reference to
 *    a module model is a "does not exist on PrismaClient" error, which is what
 *    the 429-entry baseline used to be.
 *
 * Hence `scope`. Everything else - user-relation splicing, collision checks -
 * is identical, and lives here so the two callers cannot drift.
 */

import fs from "fs";
import path from "path";

export type MergeScope = "installed" | "all-sources";

export interface MergeResult {
    schema: string;
    moduleNames: string[];
    modelCount: number;
    enumCount: number;
    warnings: string[];
}

interface ModuleSchema {
    name: string;
    content: string;
    userRelations: string[];
}

function extractUserRelations(content: string): { relations: string[]; cleanContent: string } {
    const relations: string[] = [];
    const cleanLines: string[] = [];
    let inBlock = false;

    for (const line of content.split("\n")) {
        if (line.trim() === "// @@user-relations-start") {
            inBlock = true;
            continue;
        }
        if (line.trim() === "// @@user-relations-end") {
            inBlock = false;
            continue;
        }
        if (inBlock) {
            const rel = line.replace(/^\/\/\s*/, "").trim();
            if (rel) relations.push("  " + rel);
            continue;
        }
        cleanLines.push(line);
    }

    return { relations, cleanContent: cleanLines.join("\n") };
}

function stripCommentHeader(content: string): string {
    const lines = content.split("\n");
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === "" || trimmed.startsWith("//")) startIdx = i + 1;
        else break;
    }
    return lines.slice(startIdx).join("\n");
}

function discoverModuleSchemas(root: string, scope: MergeScope): ModuleSchema[] {
    const sourcesDir = path.join(root, "module-sources");
    const installedDir = path.join(root, "src/modules");
    const schemas: ModuleSchema[] = [];

    let names: string[];
    if (scope === "all-sources") {
        names = fs.existsSync(sourcesDir)
            ? fs
                  .readdirSync(sourcesDir, { withFileTypes: true })
                  .filter((e) => e.isDirectory())
                  .map((e) => e.name)
                  .sort()
            : [];
    } else {
        names = fs.existsSync(installedDir)
            ? fs
                  .readdirSync(installedDir, { withFileTypes: true })
                  .filter((e) => e.isDirectory())
                  .map((e) => e.name)
            : [];
    }

    for (const name of names) {
        // An installed module may have been patched in place, so its own copy
        // wins over the pristine source it was installed from.
        const candidates =
            scope === "all-sources"
                ? [path.join(sourcesDir, name, "schema.prisma")]
                : [
                      path.join(installedDir, name, "schema.prisma"),
                      path.join(sourcesDir, name, "schema.prisma"),
                  ];

        const schemaPath = candidates.find((p) => fs.existsSync(p));
        if (!schemaPath) continue;

        const { relations, cleanContent } = extractUserRelations(fs.readFileSync(schemaPath, "utf-8"));
        schemas.push({ name, content: cleanContent, userRelations: relations });
    }

    return schemas;
}

export function mergeSchemas(root: string, scope: MergeScope): MergeResult {
    const coreSchemaPath = path.join(root, "prisma/schema.core.prisma");
    if (!fs.existsSync(coreSchemaPath)) {
        throw new Error("prisma/schema.core.prisma not found");
    }

    const core = fs.readFileSync(coreSchemaPath, "utf-8");
    const modules = discoverModuleSchemas(root, scope);
    const warnings: string[] = [];

    const coreModelNames = new Set<string>();
    for (const match of core.matchAll(/^model\s+(\w+)\s*\{/gm)) coreModelNames.add(match[1]);

    const modelOwners = new Map<string, string>();
    for (const mod of modules) {
        for (const match of mod.content.matchAll(/^model\s+(\w+)\s*\{/gm)) {
            const modelName = match[1];
            if (coreModelNames.has(modelName)) {
                // The merger keeps the core definition and drops the module's
                // copy, so any field the module tried to add is LOST - which
                // surfaces later as "my migration doesn't include my column".
                warnings.push(
                    `module '${mod.name}' redeclares core model '${modelName}'. The module's definition is ` +
                        `IGNORED - only the core schema version ships. To add fields or relations to a core ` +
                        `model, use the // @@user-relations-start ... // @@user-relations-end block.`,
                );
                continue;
            }
            const existingOwner = modelOwners.get(modelName);
            if (existingOwner && existingOwner !== mod.name) {
                throw new Error(
                    `Model name collision: '${modelName}' is defined in both '${existingOwner}' and ` +
                        `'${mod.name}' modules. Rename one of the models to resolve the conflict.`,
                );
            }
            modelOwners.set(modelName, mod.name);
        }
    }

    const allUserRelations: string[] = [];
    for (const mod of modules) {
        if (mod.userRelations.length > 0) {
            allUserRelations.push(`  // ${mod.name} module`, ...mod.userRelations, "");
        }
    }

    let merged = core;
    merged =
        allUserRelations.length > 0
            ? merged.replace(/\s*\/\/\s*@@MODULE_RELATIONS/, "\n\n" + allUserRelations.join("\n"))
            : merged.replace(/\s*\/\/\s*@@MODULE_RELATIONS/, "");

    for (const mod of modules) {
        const stripped = stripCommentHeader(mod.content).trim();
        if (stripped) {
            merged += `\n\n// ==================== MODULE: ${mod.name} ====================\n\n${stripped}`;
        }
    }
    merged += "\n";

    return {
        schema: merged,
        moduleNames: modules.map((m) => m.name),
        modelCount: (merged.match(/^model\s+/gm) || []).length,
        enumCount: (merged.match(/^enum\s+/gm) || []).length,
        warnings,
    };
}

/**
 * Point a merged schema's generator at `clientDir` instead of node_modules.
 *
 * The core generator block has no `output`, which lands the client in
 * node_modules and would clobber the real one. The directory is written with
 * forward slashes: a Prisma string reads each backslash as an escape, so a
 * Windows path as the platform spells it does not parse, and Prisma accepts a
 * forward slash as a separator everywhere.
 */
export function withClientOutput(schema: string, clientDir: string): string {
    return schema.replace(
        /generator\s+client\s*\{[^}]*\}/,
        `generator client {\n  provider = "prisma-client-js"\n  output   = "${clientDir.replaceAll("\\", "/")}"\n}`,
    );
}
