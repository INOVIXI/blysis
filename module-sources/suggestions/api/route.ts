import { NextRequest, NextResponse } from "next/server";
import { refuseSilenced, pageParams, hasPermission, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { readSuggestions } from "../lib/read-suggestions";

type ModerationSettingValue = {
    blog_comments?: "auto" | "manual";
    forum_topics?: "auto" | "manual";
    forum_posts?: "auto" | "manual";
    suggestions?: "auto" | "manual";
};

async function getModerationMode(field: keyof ModerationSettingValue): Promise<"auto" | "manual"> {
    const setting = await prisma.setting.findUnique({ where: { key: "moderation" } });
    const value = (setting?.value ?? {}) as ModerationSettingValue;
    return value[field] === "manual" ? "manual" : "auto";
}

// GET /api/v1/suggestions - Public list
//
// The read and the rule about what a reader may see live in
// lib/read-suggestions.ts, because the board renders on the server now and the
// two must not disagree about which suggestions are public.
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const { page, limit } = pageParams(params);
    const read = await readSuggestions({
        status: params.get("status"),
        sort: params.get("sort") || "newest",
        page,
        perPage: limit,
    });
    return NextResponse.json({
        suggestions: read.suggestions,
        total: read.total,
        pages: read.pages,
    });
}

// POST /api/v1/suggestions - Create suggestion
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // A mute on the record used to stop nothing. One call, so the next
    // endpoint somebody writes cannot quietly forget it; see write-guard.ts.
    const silenced = await refuseSilenced(session.user.id);
    if (silenced) return silenced;

    const rl = await rateLimitForRole(
        `suggestion:${session.user.id}`,
        { maxRequests: 5, windowMs: 60_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const schema = z.object({
        title: z.string().min(3).max(200),
        content: z.string().min(10).max(5000),
        visibility: z.enum(["public", "private"]).optional().default("public"),
    });
    const validation = schema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });

    const { title, content, visibility } = validation.data;

    const mode = await getModerationMode("suggestions");
    const moderationState = mode === "manual" ? "PENDING" : "APPROVED";

    const suggestion = await prisma.suggestion.create({
        data: {
            title,
            content: content,
            visibility,
            authorId: session.user.id,
            moderationState,
        },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
        },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("suggestions.suggestion.created", suggestion);

    // Activity feed entry (public only if visibility public)
    await prisma.activityFeedItem.create({
        data: {
            type: "suggestions.suggestion.created",
            actorId: session.user.id,
            title: `Suggested: ${suggestion.title}`,
            href: `/suggestions/${suggestion.id}`,
            icon: "Lightbulb",
            isPublic: visibility === "public",
        },
    }).catch(() => {});

    return NextResponse.json({ suggestion }, { status: 201 });
}
