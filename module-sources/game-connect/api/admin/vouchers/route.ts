/**
 * GET /api/v1/game-connect/admin/vouchers - every voucher, newest first.
 *
 * Shows who made each one and who redeemed it, by username, and finds one by
 * either name or by the end of its id with `q`. The id is the
 * whole voucher, so the list shows only its last characters: an admin can tell
 * two apart without the screen becoming a sheet of spendable codes.
 */
import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../lib/admin";

export async function GET(request: NextRequest) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

    const url = new URL(request.url);
    const { page, limit, skip } = pageParams(url.searchParams, { defaultLimit: 50 });
    const state = url.searchParams.get("state");
    const term = (url.searchParams.get("q") ?? "").trim().slice(0, 64);
    const members = term
        ? await prisma.user.findMany({
              where: { username: { contains: term, mode: "insensitive" } },
              select: { id: true },
              take: 50,
          })
        : [];
    const memberIds = members.map((member) => member.id);
    const where = {
        ...(state === "open" ? { redeemedAt: null } : state === "redeemed" ? { redeemedAt: { not: null } } : {}),
        // The end of an id is what the screen shows, so it is what an admin types back.
        ...(term
            ? { OR: [{ id: { endsWith: term } }, { createdById: { in: memberIds } }, { redeemedById: { in: memberIds } }] }
            : {}),
    };

    const [vouchers, total] = await Promise.all([
        prisma.gameConnectVoucher.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
        prisma.gameConnectVoucher.count({ where }),
    ]);
    const ids = [...new Set(vouchers.flatMap((v) => [v.createdById, v.redeemedById]).filter((id): id is string => Boolean(id)))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true }, take: ids.length });
    const names = new Map(users.map((user) => [user.id, user.username]));

    return NextResponse.json({
        vouchers: vouchers.map((voucher) => ({
            hint: voucher.id.slice(-6),
            amount: Number(voucher.amount),
            origin: voucher.origin,
            createdBy: voucher.createdById ? (names.get(voucher.createdById) ?? null) : null,
            createdOnServer: voucher.createdOnServer,
            redeemedBy: voucher.redeemedById ? (names.get(voucher.redeemedById) ?? null) : null,
            redeemedAt: voucher.redeemedAt,
            createdAt: voucher.createdAt,
        })),
        total,
        page,
        limit,
    });
}
