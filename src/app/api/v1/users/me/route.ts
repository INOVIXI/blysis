import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { rateLimitForRoleAsync } from "@/core/lib/rate-limit";
import { prisma } from "@/core/lib/db";
import { updateUserSchema } from "@/core/lib/validations";
import { readJsonBody } from "@/core/lib/api-body";
import { log } from "@/core/lib/logger";

// GET /api/v1/users/me - Get current user
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

// PATCH /api/v1/users/me - Update current user
export async function PATCH(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const allowed = await rateLimitForRoleAsync(
            `profile-update:${session.user.id}`,
            { maxRequests: 30, windowMs: 60_000 },
            session.user.role
        );
        if (!allowed) {
            return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
        }

        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = updateUserSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const { username, avatar } = validation.data;

        // Check if username is taken
        if (username) {
            const existing = await prisma.user.findFirst({
                where: {
                    username,
                    NOT: { id: session.user.id },
                },
            });

            if (existing) {
                return NextResponse.json(
                    { error: "Username already taken" },
                    { status: 400 }
                );
            }
        }

        const user = await prisma.user.update({
            where: { id: session.user.id },
            data: {
                ...(username && { username }),
                ...(avatar !== undefined && { avatar }),
            },
            select: {
                id: true,
                email: true,
                username: true,
                avatar: true,
            },
        });

        return NextResponse.json({ user });
    } catch (error) {
        log.error("Update user error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
