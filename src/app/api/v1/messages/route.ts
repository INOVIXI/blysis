import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { oneToOneConversationWhere } from "@/core/lib/conversations";
import { rateLimitForRole } from "@/core/lib/rate-limit";
import { readJsonBody } from "@/core/lib/api-body";
import { pageParams } from "@/core/lib/page-params";
import { refuseSilenced } from "@/core/lib/write-guard";

/**
 * GET - list current user's conversations with last message preview
 *       and unread count
 *
 * Query: ?page=1&limit=10&q=
 *
 * It used to answer with every conversation the account had ever had, newest
 * first, and the screen drew all of them. An inbox is the one list on a
 * member's account that only grows, and the one where the thing being looked
 * for is usually old - so a page at a time, and a term that reads the other
 * side's name, the conversation's own title and what was actually said.
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const { page, limit, skip, take } = pageParams(searchParams, { defaultLimit: 10, maxLimit: 50 });
    const term = (searchParams.get("q") ?? "").trim();

    // Every clause hangs off conversations this account is already in, so the
    // body match is a correlated exists over one person's own threads rather
    // than a scan of the site's messages.
    const where = {
        userId,
        ...(term
            ? {
                  conversation: {
                      OR: [
                          { title: { contains: term, mode: "insensitive" as const } },
                          {
                              participants: {
                                  some: {
                                      userId: { not: userId },
                                      user: { username: { contains: term, mode: "insensitive" as const } },
                                  },
                              },
                          },
                          { messages: { some: { body: { contains: term, mode: "insensitive" as const } } } },
                      ],
                  },
              }
            : {}),
    };

    const [myParticipations, total] = await Promise.all([
        prisma.conversationParticipant.findMany({
            where,
            include: {
                conversation: {
                    include: {
                        participants: {
                            include: { user: { select: { id: true, username: true, avatar: true } } },
                        },
                        messages: {
                            orderBy: { createdAt: "desc" },
                            take: 1,
                        },
                    },
                },
            },
            orderBy: { conversation: { lastMessageAt: "desc" } },
            skip,
            take,
        }),
        prisma.conversationParticipant.count({ where }),
    ]);

    // Unread counts in one grouped query.
    //
    // The cutoff is per conversation - each participation carries its own
    // lastReadAt - which is why this used to read every inbound message the
    // user had ever received and bucket them in memory. That is O(all of the
    // user's messages) on every load of the conversation list, for a number
    // that is almost always small. An OR of one clause per conversation says
    // the same thing to the database, which counts them without sending a row.
    const unreadById = new Map<string, number>();

    if (myParticipations.length > 0) {
        const grouped = await prisma.message.groupBy({
            by: ["conversationId"],
            _count: { _all: true },
            where: {
                authorId: { not: userId },
                OR: myParticipations.map((p) => ({
                    conversationId: p.conversationId,
                    ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
                })),
            },
        });

        for (const row of grouped) {
            unreadById.set(row.conversationId, row._count._all);
        }
    }

    const conversations = myParticipations.map((p) => ({
        id: p.conversation.id,
        title: p.conversation.title,
        participants: p.conversation.participants
            .filter((cp: { userId: string }) => cp.userId !== userId)
            .map((cp: { user: { id: string; username: string; avatar: string | null } }) => cp.user),
        lastMessage: p.conversation.messages[0] || null,
        lastMessageAt: p.conversation.lastMessageAt,
        unreadCount: unreadById.get(p.conversationId) ?? 0,
    }));

    return NextResponse.json({
        conversations,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
}

const startSchema = z.object({
    recipientId: z.string().min(1),
    body: z.string().min(1).max(10000),
});

/**
 * POST - start a new conversation with a recipient (or reuse the existing
 * 1:1 conversation between the two users)
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // A mute on the record used to stop nothing. One call, so the next
    // endpoint somebody writes cannot quietly forget it; see write-guard.ts.
    const silenced = await refuseSilenced(session.user.id);
    if (silenced) return silenced;

    // Starting a conversation writes into someone else's inbox, and the
    // recipient is whoever the sender names, so one account could fan out to
    // every user on the site. A budget, not a brute-force ceiling: this is
    // throughput, so an operator's role multipliers apply.
    const rl = await rateLimitForRole(
        `message-start:${session.user.id}`,
        { maxRequests: 20, windowMs: 15 * 60 * 1000 },
        session.user.role,
    );
    if (!rl.success) {
        return NextResponse.json(
            { error: "Too many messages. Try again later." },
            { status: 429 },
        );
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid" }, { status: 400 });
    }

    if (parsed.data.recipientId === session.user.id) {
        return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
    }

    // Look for an existing 1:1 conversation between these two users. See
    // core/lib/conversations.ts for why "every" alone is not enough.
    const existing = await prisma.conversation.findFirst({
        where: oneToOneConversationWhere(session.user.id, parsed.data.recipientId),
        include: { participants: true },
    });

    let conversationId: string;
    if (existing && existing.participants.length === 2) {
        conversationId = existing.id;
    } else {
        const created = await prisma.conversation.create({
            data: {
                participants: {
                    create: [
                        { userId: session.user.id },
                        { userId: parsed.data.recipientId },
                    ],
                },
            },
        });
        conversationId = created.id;
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

    return NextResponse.json({ conversationId, message }, { status: 201 });
}
