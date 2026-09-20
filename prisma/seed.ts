// Reads DATABASE_URL from .env - this script is run directly via tsx,
// outside Next.js, which is what normally loads the env file.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    console.log("[seed]Seeding database...\n");

    // ==================== ROLES ====================
    const adminRole = await prisma.role.upsert({
        where: { name: "admin" },
        update: {},
        create: { name: "admin", displayName: "Administrator", color: "#ef4444", priority: 100 },
    });
    await prisma.role.upsert({
        where: { name: "moderator" },
        update: {},
        create: { name: "moderator", displayName: "Moderator", color: "#8b5cf6", priority: 50 },
    });
    await prisma.role.upsert({
        where: { name: "member" },
        update: {},
        create: { name: "member", displayName: "Member", color: "#6b7280", priority: 0, isDefault: true },
    });
    console.log("[ok]Roles");

    // ==================== PERMISSIONS ====================
    // Nothing to seed. The vocabulary comes from core's own list and from the
    // installed manifests, and what a role says about a name is a row on that
    // role. A table of names was a second copy of a list nobody edits.

    // ==================== ADMIN USER ====================
    // No fixed default: a shipped password ends up unchanged on real
    // deployments, and "password123" is on core's own weak-password list.
    // Set SEED_ADMIN_PASSWORD to choose one; otherwise a random one is
    // generated and printed once, here, and never again.
    const generated = !process.env.SEED_ADMIN_PASSWORD;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? crypto.randomBytes(18).toString("base64url");
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
    const pw = await bcrypt.hash(adminPassword, 12);

    // `update` deliberately leaves `password` alone: re-seeding an existing
    // install must not reset an admin's chosen password.
    const admin = await prisma.user.upsert({
        where: { email: adminEmail },
        update: { roleId: adminRole.id },
        create: { email: adminEmail, username: "blysisadmin", password: pw, roleId: adminRole.id },
    });
    /*
     * The role as a row, not only as a name beside theirs.
     *
     * Since `001_a_member_holds_a_set_of_roles`, a member's roles are the
     * rows in `UserRole`; `roleId` above is the one shown next to their name
     * and nothing reads it to decide what they may do. Setting only that made
     * an administrator who holds no roles: signing in worked and `/admin`
     * sent them home again.
     *
     * The migration back-fills this row on a site being upgraded. A database
     * made by `prisma db push` never runs migrations, which is how a first
     * install and CI both get theirs - so the seed writes it.
     *
     * Upsert, because some installations run the seed on every deploy and the
     * pair is unique: a bare create would throw the second time and take the
     * rest of the seed with it.
     */
    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
        update: {},
        create: { userId: admin.id, roleId: adminRole.id, source: "seed" },
    });

    const created = admin.createdAt.getTime() === admin.updatedAt.getTime();
    console.log("[ok]Admin user");

    console.log("\n[done]Seeding complete!");
    if (created) {
        console.log(`   Admin account: ${adminEmail}`);
        if (generated) {
            console.log(`   Generated password (shown once): ${adminPassword}`);
            console.log("   Set SEED_ADMIN_PASSWORD to choose your own.\n");
        } else {
            console.log("   Password: the SEED_ADMIN_PASSWORD you supplied.\n");
        }
    } else {
        console.log(`   Admin account ${adminEmail} already existed - password left unchanged.\n`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
