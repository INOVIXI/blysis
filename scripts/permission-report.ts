/**
 * What the panel will look like to each role once the door moves.
 *
 * Enforcement is a later phase on purpose. Switching a deny-by-default gate on
 * without first reading what it denies is how a permission system arrives as
 * an outage, so this prints the answer in advance: every declared path, the
 * permission that opens it, and - when the database is reachable - what each
 * role that exists today would and would not reach.
 *
 * Usage: npx tsx scripts/permission-report.ts
 */

import "dotenv/config";
import { ADMIN_PAGE_RULES, API_WRITE_RULES } from "../src/core/generated/permission-map";

interface RoleRow {
    name: string;
    displayName: string;
    permissions: { name: string }[];
}

function countBy(rules: { permission: string | null; openTo?: string }[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const rule of rules) {
        const key = rule.permission ?? (rule.openTo ? `open:${rule.openTo}` : "undeclared");
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

function printCounts(title: string, counts: Map<string, number>): void {
    console.log(`\n${title}`);
    for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(4)}  ${key}`);
    }
}

async function roles(): Promise<RoleRow[]> {
    try {
        const { prisma } = await import("../src/core/lib/db");
        return (await prisma.role.findMany({
            include: { permissions: true },
            orderBy: { priority: "desc" },
        })) as RoleRow[];
    } catch (error) {
        console.log(`\nNo database read: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

async function main(): Promise<void> {
    printCounts(`Panel screens (${ADMIN_PAGE_RULES.length})`, countBy(ADMIN_PAGE_RULES));
    printCounts(`Writes (${API_WRITE_RULES.length})`, countBy(API_WRITE_RULES));

    const undeclaredPages = ADMIN_PAGE_RULES.filter((rule) => !rule.permission && !rule.openTo);
    const undeclaredWrites = API_WRITE_RULES.filter((rule) => !rule.permission && !rule.openTo);
    if (undeclaredPages.length || undeclaredWrites.length) {
        console.log(
            `\nReachable by an administrator and nobody else: ${undeclaredPages.length} screen(s), ${undeclaredWrites.length} write(s)`,
        );
    }

    const existing = await roles();
    if (existing.length === 0) return;

    const pageNames = new Set(ADMIN_PAGE_RULES.map((rule) => rule.permission).filter(Boolean) as string[]);
    console.log(`\nWhat each role reaches, of ${pageNames.size} permission(s) that open a screen:`);
    for (const role of existing) {
        if (role.name === "admin") {
            console.log(`  ${role.displayName} (${role.name}): everything, by bypass`);
            continue;
        }
        const held = new Set(role.permissions.map((permission) => permission.name));
        const reachable = [...pageNames].filter((name) => held.has(name));
        const refused = [...pageNames].filter((name) => !held.has(name));
        console.log(`  ${role.displayName} (${role.name}): ${reachable.length} reachable, ${refused.length} refused`);
        if (reachable.length > 0) console.log(`      opens: ${reachable.sort().join(", ")}`);
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => process.exit());
