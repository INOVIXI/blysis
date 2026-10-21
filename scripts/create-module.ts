import fs from "fs";
import path from "path";
import { CORE_API_VERSION } from "../src/core/lib/core-version";

const ROOT = process.cwd();
const TEMPLATE_DIR = path.join(ROOT, "module-template");
const OUTPUT_BASE = path.join(ROOT, "module-sources");

function usage(): never {
    console.error("Usage: npx tsx scripts/create-module.ts <module-id> [\"Module Name\"] [\"Description\"]");
    console.error("");
    console.error("  module-id     Lowercase alphanumeric + hyphens (e.g., my-awesome-module)");
    console.error("  Module Name   Display name (default: derived from ID)");
    console.error("  Description   Short description (default: empty)");
    console.error("");
    console.error("Example:");
    console.error("  npx tsx scripts/create-module.ts game-stats \"Game Stats\" \"Player statistics tracking\"");
    process.exit(1);
}

function toTitleCase(id: string): string {
    return id
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function toPascalCase(id: string): string {
    return id
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
}

function toCamelCase(id: string): string {
    const pascal = toPascalCase(id);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function validateId(id: string): boolean {
    return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(id) && !id.includes("--");
}

function copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function replaceInFile(filePath: string, replacements: Map<string, string>): void {
    let content = fs.readFileSync(filePath, "utf8");

    for (const [search, replace] of replacements) {
        content = content.split(search).join(replace);
    }

    fs.writeFileSync(filePath, content);
}

function walkFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(fullPath));
        } else {
            results.push(fullPath);
        }
    }

    return results;
}

function main(): void {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        usage();
    }

    const moduleId = args[0];
    const moduleName = args[1] || toTitleCase(moduleId);
    const moduleDescription = args[2] || "";

    // Validate module ID
    if (!validateId(moduleId)) {
        console.error(`Error: Invalid module ID "${moduleId}".`);
        console.error("Must be lowercase alphanumeric + hyphens, start with a letter, no double hyphens.");
        process.exit(1);
    }

    // Check if template exists
    if (!fs.existsSync(TEMPLATE_DIR)) {
        console.error(`Error: Template directory not found at ${TEMPLATE_DIR}`);
        process.exit(1);
    }

    // Check if module already exists
    const outputDir = path.join(OUTPUT_BASE, moduleId);
    if (fs.existsSync(outputDir)) {
        console.error(`Error: Module "${moduleId}" already exists at ${outputDir}`);
        process.exit(1);
    }

    // Ensure output base directory exists
    fs.mkdirSync(OUTPUT_BASE, { recursive: true });

    // Copy template
    console.log(`Creating module "${moduleId}" from template...`);
    copyDir(TEMPLATE_DIR, outputDir);

    // Build replacement map
    const pascalCase = toPascalCase(moduleId);
    const camelCase = toCamelCase(moduleId);

    const replacements = new Map<string, string>([
        // module.json and general
        ["my-module", moduleId],
        ["My Module", moduleName],
        ["A template module for Blysis", moduleDescription || `${moduleName} module for Blysis`],

        // Code identifiers
        ["MyModule", pascalCase],
        ["myModule", camelCase],
        ["mymodule", moduleId.replace(/-/g, "")],

        // Prisma model names
        ["MyModuleItem", `${pascalCase}Item`],
        ["myModuleItems", `${camelCase}Items`],

        // Translations namespace
        ["\"myModule\"", `"${camelCase}"`],

        // Description placeholders in translations
        ["Example module for Blysis", moduleDescription || `${moduleName} module`],
        ["Blysis icin ornek modul", moduleDescription || `${moduleName} modulu`],
        ["Beispielmodul fuer Blysis", moduleDescription || `${moduleName} Modul`],

        // Turkish/German name placeholders
        ["Modulom", moduleName],
        ["Mein Modul", moduleName],
    ]);

    // Replace placeholders in all files
    const files = walkFiles(outputDir);
    for (const file of files) {
        // Skip binary files
        const ext = path.extname(file);
        if ([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf"].includes(ext)) {
            continue;
        }

        replaceInFile(file, replacements);
    }

    // Update module.json: parse and set fields properly
    const manifestPath = path.join(outputDir, "module.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    // Remove the _comment field
    delete manifest._comment;

    // Ensure core fields are correct
    manifest.id = moduleId;
    manifest.name = moduleName;
    manifest.description = moduleDescription || `${moduleName} module for Blysis`;
    // From the running contract rather than the template, which cannot keep
    // up with it: install refuses a module whose range the core does not meet.
    manifest.coreVersion = `^${CORE_API_VERSION.split(".")[0]}.0.0`;

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");

    console.log("");
    console.log(`Module created at: ${outputDir}`);
    console.log("");
    console.log("Next steps:");
    console.log(`  1. Edit module.json    - remove fields you don't need`);
    console.log(`  2. Edit schema.prisma  - define your database models (or delete if not needed)`);
    console.log(`  3. npm run db:merge    - merge your schema into the main Prisma schema`);
    console.log(`  4. npm run db:push     - apply database changes`);
    console.log(`  5. Copy to src/modules/${moduleId}/ to install the module`);
    console.log(`  6. npx tsx scripts/generate-registry.ts - register routes`);
    console.log(`  7. npm run dev         - start development`);
    console.log("");
    console.log("Validate your module:");
    console.log(`  npm run validate:module module-sources/${moduleId}`);
}

main();
