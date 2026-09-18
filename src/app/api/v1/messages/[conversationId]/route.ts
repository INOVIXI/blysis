import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { rateLimitForRole } from "@/core/lib/rate-limit";
import { readJsonBody } from "@/core/lib/api-body";
import { refuseSilenced } from "@/core/lib/write-guard";

type RouteParams = { params: Promise<{ conversationId: string }> };

/** Messages returned per read: the newest this many, oldest first. */
const MESSAGE_PAGE_SIZE = 200;

/** GET - fetch the newest page of a conversation + mark as read */
export async function GET(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { conversationId } = await params;

    // Verify the user is a participant
    const participation = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId: session.user.id } },
    });
    if (!participation) {
        return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    // The newest page, read newest-first and handed back in reading order. A
    // thread grows without limit and every open re-read all of it, so this
    // query and its response had no ceiling; each message is up to 10000
    // characters, so the ceiling matters.
    const page = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: MESSAGE_PAGE_SIZE,
        include: { author: { select: { id: true, username: true, avatar: true } } },
    });
    const messages = page.reverse();

    // Mark as read
    await prisma.conversationParticipant.update({
        where: { id: participation.id },
        data: { lastReadAt: new Date() },
    });

    return NextResponse.json({ messages });
}

const replySchema = z.object({
    body: z.string().min(1).max(10000),
});

/** POST - reply to an existing conversation */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // A mute on the record used to stop nothing. One call, so the next
    // endpoint somebody writes cannot quietly forget it; see write-guard.ts.
    const silenced = await refuseSilenced(session.user.id);
    if (silenced) return silenced;

    // Same budget as starting one: a reply is a write into the other
    // participant's inbox.
    const rl = await rateLimitForRole(
        `message-reply:${session.user.id}`,
        { maxRequests: 60, windowMs: 15 * 60 * 1000 },
        session.user.role,
    );
    if (!rl.success) {
        return NextResponse.json(
            { error: "Too many messages. Try again later." },
            { status: 429 },
        );
    }

    const { conversationId } = await params;
    const participation = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId: session.user.id } },
    });
    if (!participation) {
        return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = replySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid" }, { status: 400 });
    }

    const message = await prisma.message.create({
        data: {
            conversationId,
            authorId: session.user.id,
            body: parsed.data.body,
        },
    });

    await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.createdAt },
    });

    return NextResponse.json({ message }, { status: 201 });
}
