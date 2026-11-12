import { NextRequest, NextResponse } from "next/server";
import { prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { nanoid } from "nanoid";
import { applyReferralSchema } from "../lib/validations";

// GET /api/v1/referral - Get user's referral code + stats
export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { referralCode: true },
    });

    // Generate referral code if not exists
    let referralCode = user?.referralCode;
    if (!referralCode) {
        referralCode = nanoid(8).toUpperCase();
        await prisma.user.update({
            where: { id: session.user.id },
            data: { referralCode },
        });
    }

    // Get referral stats
    const referrals = await prisma.referral.findMany({
        where: { referrerId: session.user.id },
        include: {
            referred: {
                select: { username: true, avatar: true, createdAt: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    const totalReferrals = referrals.length;
    const completedReferrals = referrals.filter(r => r.status === "completed" || r.status === "rewarded").length;
    const pendingReferrals = referrals.filter(r => r.status === "pending").length;
    const creditsEarned = referrals
        .filter(r => r.status === "rewarded")
        .reduce((sum, r) => sum + Number(r.rewardAmount), 0);

    return NextResponse.json({
        referralCode,
        stats: {
            totalReferrals,
            completedReferrals,
            pendingReferrals,
            creditsEarned,
        },
        referrals: referrals.map(r => ({
            id: r.id,
            username: r.referred?.username ?? "Deleted user",
            avatar: r.referred?.avatar ?? null,
            status: r.status,
            rewardAmount: Number(r.rewardAmount),
            createdAt: r.createdAt,
        })),
    });
}

// POST /api/v1/referral - Apply referral code
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimitForRole(
        `referral-apply:${session.user.id}`,
        { maxRequests: 3, windowMs: 3_600_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = applyReferralSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: "Referral code is required" }, { status: 400 });
    }
    const { referralCode } = parsed.data;

    // Check if user already has a referral
    const existingReferral = await prisma.referral.findUnique({
        where: { referredId: session.user.id },
    });
    if (existingReferral) {
        return NextResponse.json({ error: "You have already used a referral code" }, { status: 400 });
    }

    // Check if user already set a referredBy
    const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { referredBy: true },
    });
    if (currentUser?.referredBy) {
        return NextResponse.json({ error: "You have already been referred" }, { status: 400 });
    }

    // Find referrer by code
    const referrer = await prisma.user.findFirst({
        where: { referralCode: referralCode.toUpperCase() },
        select: { id: true, username: true },
    });
    if (!referrer) {
        return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });
    }

    // Cannot refer yourself
    if (referrer.id === session.user.id) {
        return NextResponse.json({ error: "You cannot use your own referral code" }, { status: 400 });
    }

    // Get reward amount from settings
    const rewardSetting = await prisma.setting.findUnique({
        where: { key: "referral_reward_amount" },
    });
    const rewardAmount = Number(rewardSetting?.value) || 5;

    // Only the record is written here. The reward is paid when this member
    // first pays for an order (hooks/on-order-completed.ts): paying on the code
    // alone let anybody collect it with accounts made for the purpose.
    await prisma.$transaction(async (tx) => {
        await tx.referral.create({
            data: {
                referrerId: referrer.id,
                referredId: session.user.id,
                rewardAmount,
                status: "pending",
            },
        });
        await tx.user.update({
            where: { id: session.user.id },
            data: { referredBy: referrer.id },
        });
    });

    // Fire hook + activity feed entry
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("referral.referral.used", {
        referrerId: referrer.id,
        referredId: session.user.id,
        rewardAmount,
    });
    await prisma.activityFeedItem.create({
        data: {
            type: "referral.referral.used",
            actorId: session.user.id,
            title: `Joined via referral from ${referrer.username}`,
            icon: "UserPlus",
            isPublic: true,
        },
    }).catch(() => {});

    return NextResponse.json({
        message: "Referral code applied successfully",
        referrer: referrer.username,
    });
}
