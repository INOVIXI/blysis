/**
 * Additive-only schema sync.
 *
 * The problem this exists to solve: installing a module at runtime has to
 * create that module's tables, and `prisma db push` - the tool the design
 * originally reached for - cannot do that safely on a live database.
 *
 * `db push` reconciles the whole database to the merged schema, which means it
 * also removes anything the schema no longer declares. Uninstall deliberately
 * leaves a module's tables in place so a reinstall does not lose the admin's
 * data (see the comment in `src/app/api/v1/modules/[id]/route.ts`), so after
 * any uninstall the database legitimately holds tables the schema does not
 * mention. Both of `db push`'s answers to that are wrong:
 *
 *   - the leftover table is empty  → it is dropped, silently, exit 0. The
 *     "preserved for reinstall" promise is quietly broken.
 *   - the leftover table has rows  → the push refuses outright
 *     ("Use the --accept-data-loss flag"), so the module being installed
 *     never gets its tables either.
 *
 * Both were reproduced against a real install before this script existed.
 *
 * So: ask Prisma for the diff rather than letting it apply one, and run only
 * the statements that add. `prisma migrate diff --script` annotates every
 * statement with the operation that produced it (`-- CreateTable`,
 * `-- DropTable`, `-- AlterTable`, …), so the filter reads those annotations
 * instead of parsing SQL. Anything not provably additive is skipped and
 * named in the log - destructive and altering changes are what a module's
 * `migrations/` directory is for.
 *
 * Usage:
 *   npx tsx scripts/apply-schema-additions.ts             # apply
 *   npx tsx scripts/apply-schema-additions.ts --dry-run   # print the plan
 */

import "dotenv/config";
import { execFileSync } from "child_process";
import { prisma } from "../src/core/lib/db";
import { toolCommand } from "../src/core/lib/tool-command";

/**
 * Operations that only ever add. `AlterTable` is deliberately absent - it is
 * handled separately below, because Prisma emits both `ADD COLUMN` and
 * `DROP COLUMN` under that one annotation.
 */
const ADDITIVE_OPERATIONS = new Set([
    "CreateSchema",
    "CreateEnum",
    "CreateTable",
    "CreateIndex",
    "AddForeignKey",
]);

export interface SqlStatement {
    /** The `-- <Operation>` annotation Prisma emitted above the statement. */
    operation: string;
    sql: string;
}

export interface Plan {
    apply: SqlStatement[];
    skip: SqlStatement[];
}

/**
 * Split a `migrate diff --script` output into annotated statements.
 *
 * Prisma writes one `-- <Operation>` comment before each statement. Anything
 * before the first annotation is preamble (the Prisma config banner) and is
 * dropped.
 *
 * Two conditions make a line an annotation rather than an ordinary comment,
 * because generated SQL contains comments of its own: it must start at column
 * zero (Prisma indents everything inside a statement), and the statement
 * being accumulated must already be closed by a semicolon. Treating a comment
 * *inside* a CREATE TABLE as the start of a new statement would split that
 * table in half and run both halves.
 */
export function parseDiffScript(script: string): SqlStatement[] {
    const statements: SqlStatement[] = [];
    let operation: string | null = null;
    let buffer: string[] = [];

    const flush = () => {
        if (operation === null) return;
        const sql = buffer.join("\n").trim();
        if (sql) statements.push({ operation, sql });
        buffer = [];
    };

    const bufferIsClosed = (): boolean => {
        for (let i = buffer.length - 1; i >= 0; i--) {
            const line = buffer[i]?.trim() ?? "";
            if (line === "") continue;
            return line.endsWith(";");
        }
        return true;
    };

    for (const line of script.split("\n")) {
        const annotation = /^--[ \t]*([A-Za-z][A-Za-z0-9_]*)[ \t]*$/.exec(line);
        if (annotation && bufferIsClosed()) {
            flush();
            operation = annotation[1] ?? null;
            continue;
        }
        if (operation !== null) buffer.push(line);
    }
    flush();

    return statements;
}

/**
 * An `AlterTable` is additive only when it adds and removes nothing. A
 * `DROP` anywhere in it removes a column or constraint; an `ALTER COLUMN`
 * changes a type, which can lose data on its own.
 */
export function isAdditiveAlterTable(sql: string): boolean {
    const upper = sql.toUpperCase();
    if (upper.includes("DROP ")) return false;
    if (upper.includes("ALTER COLUMN")) return false;
    return upper.includes("ADD ");
}

export function planFromScript(script: string): Plan {
    const apply: SqlStatement[] = [];
    const skip: SqlStatement[] = [];

    for (const statement of parseDiffScript(script)) {
        const additive = ADDITIVE_OPERATIONS.has(statement.operation)
            || (statement.operation === "AlterTable" && isAdditiveAlterTable(statement.sql));
        (additive ? apply : skip).push(statement);
    }

    return { apply, skip };
}

function diffScript(): string {
    // --from-config-datasource reads the live database through the datasource
    // in prisma.config.ts; --to-schema is the merged schema on disk. Prisma 7
    // removed --from-url, which is what the equivalent call used to look like.
    return execFileSync(
        ...toolCommand([
            "npx", "prisma", "migrate", "diff",
            "--from-config-datasource",
            "--to-schema", "prisma/schema.prisma",
            "--script",
        ]),
        { cwd: process.cwd(), encoding: "utf-8", timeout: 120000 },
    );
}

export interface ApplyOutcome {
    applied: number;
    skipped: SqlStatement[];
}

export async function applySchemaAdditions(dryRun = false): Promise<ApplyOutcome> {
    const plan = planFromScript(diffScript());

    for (const statement of plan.skip) {
        console.log(`[schema-additions] skipping ${statement.operation}: ${statement.sql.split("\n")[0]}`);
    }

    if (plan.apply.length === 0) {
        console.log("[schema-additions] database already has everything the schema declares.");
        return { applied: 0, skipped: plan.skip };
    }

    if (dryRun) {
        for (const statement of plan.apply) {
            console.log(`[schema-additions] would apply ${statement.operation}: ${statement.sql.split("\n")[0]}`);
        }
        return { applied: 0, skipped: plan.skip };
    }

    // One transaction: a half-created module schema is worse than none, and
    // Postgres runs DDL transactionally.
    await prisma.$transaction(async (tx) => {
        for (const statement of plan.apply) {
            await tx.$executeRawUnsafe(statement.sql);
        }
    });

    console.log(`[schema-additions] applied ${plan.apply.length} statement(s).`);
    return { applied: plan.apply.length, skipped: plan.skip };
}

const invokedDirectly = process.argv[1]?.includes("apply-schema-additions");
if (invokedDirectly) {
    applySchemaAdditions(process.argv.includes("--dry-run"))
        .then(async () => { await prisma.$disconnect(); })
        .catch(async (err: unknown) => {
            console.error("[schema-additions] failed:", err instanceof Error ? err.message : String(err));
            await prisma.$disconnect();
            process.exit(1);
        });
}
