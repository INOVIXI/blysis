import { NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { log } from "@/core/lib/logger";

// GET /api/v1/users/me - Get current user
//
// Read-only on purpose. A member changes their own account through
// `/api/v1/auth/profile`, which asks the operator's rules on the way: whether
// renaming is open, whether it takes the password, which names are free. A
// second write path here answered to none of them.
export async function GET() {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
                id: true,
                email: true,
                username: true,
                avatar: true,
                emailVerified: true,
                createdAt: true,
                role: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                        color: true,
                        rolePermissions: {
                            // What the role says yes to. A refusal is not a
                            // capability, so it has no place in a list of what
                            // somebody may do.
                            where: { state: "ALLOW" },
                            select: { permission: true },
                        },
                    },
                },
            },
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        return NextResponse.json({ user });
    } catch (error) {
        log.error("Get current user error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
