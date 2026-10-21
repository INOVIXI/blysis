// Merge Prisma Schemas
//
// Reads prisma/schema.core.prisma (base) + the schema.prisma of every INSTALLED
// module, merges them into prisma/schema.prisma and regenerates the client.
//
// Module schemas can declare User relation fields via a special comment block:
//   // @@user-relations-start
//   //   fieldName Type[] @relation("Name")
//   // @@user-relations-end
//
// The core schema has a marker: // @@MODULE_RELATIONS
// which is replaced with all collected user relations.
//
// The merge itself lives in scripts/lib/merge-prisma-schemas.ts, shared with
// scripts/typecheck-modules.ts so the runtime schema and the schema modules are
// type-checked against cannot drift apart.
//
// Usage: npx tsx scripts/merge-schemas.ts

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { mergeSchemas } from "./lib/merge-prisma-schemas";
import { toolCommand } from "../src/core/lib/tool-command";

const ROOT = process.cwd();
const OUTPUT_SCHEMA = path.join(ROOT, "prisma/schema.prisma");

try {
    console.log("Merging Prisma schemas...");
    const result = mergeSchemas(ROOT, "installed");
    for (const warning of result.warnings) console.warn(`[merge-schemas] WARNING: ${warning}`);

    fs.writeFileSync(OUTPUT_SCHEMA, result.schema, "utf-8");
    console.log(`Written merged schema to ${OUTPUT_SCHEMA}`);
    console.log(`Total: ${result.modelCount} models, ${result.enumCount} enums`);

    console.log("Running prisma generate...");
    execFileSync(...toolCommand(["npx", "prisma", "generate"]), { cwd: ROOT, timeout: 30000, stdio: "inherit" });
    console.log("Prisma client generated successfully.");
} catch (err) {
    console.error("Schema merge failed:", err);
    process.exit(1);
}
