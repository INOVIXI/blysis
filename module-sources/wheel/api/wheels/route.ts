import { NextRequest, NextResponse } from "next/server";
import { prisma, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { refusalFor, nextTurnAt } from "../../lib/wheels";
import { PRIZE_TEXT, WHEEL_TEXT } from "../../lib/validations";

/**
 * The wheels this visitor can see, and what each of them will let them do.
 *
 * One answer rather than a list plus a probe per wheel: the page draws a
 * button per wheel and every one of them needs the same four facts - is it on,
 * may I turn it, when may I turn it next, and what does it cost.
 *
 * This used to answer two different shapes at one address, picked by whether
 * the reader was an administrator: a visitor got wheels with their prizes,
 * an administrator got the raw rows their editing screen wanted. The page
 * lists what is on the wheel, so an administrator opening /wheel got a
 * TypeError instead of a page. An administrator browsing the site is a
 * visitor; the screen that manages wheels asks /api/v1/wheel/admin/wheels,
 * which is a different question and says so in its address.
 *
 * The names, descriptions and prize labels are in `?locale=`, and the
 * original where the admin wrote no translation.
 */

/** Names the reader, so no shared cache may hold a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
    const session = await auth();
    const locale = new URL(request.url).searchParams.get("locale") ?? "";

    const [rows, user] = await Promise.all([
        prisma.wheel.findMany({
            where: { isActive: true },
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            include: {
                prizes: {
                    where: { isActive: true },
                    orderBy: { order: "asc" },
                    select: { id: true, name: true, color: true, type: true, value: true },
                },
            },
        }),
        session?.user?.id
            ? prisma.user.findUnique({
                where: { id: session.user.id },
                select: { creditBalance: true, roleId: true },
            })
            : Promise.resolve(null),
    ]);

    // Two queries for the page however many wheels and prizes it holds.
    const named = await translateContent(prisma, WHEEL_TEXT, rows, ["name", "description"], locale);
    const labels = await translateContent(prisma, PRIZE_TEXT, rows.flatMap((wheel) => wheel.prizes), ["name"], locale);
    const labelOf = new Map(labels.map((prize) => [prize.id, prize.name]));
    const wheels = named.map((wheel) => ({
        ...wheel,
        prizes: wheel.prizes.map((prize) => ({ ...prize, name: labelOf.get(prize.id) ?? prize.name })),
    }));

    // One query for every wheel's last turn rather than one per wheel.
    const lastTurns = session?.user?.id
        ? await prisma.wheelSpin.groupBy({
            by: ["wheelId"],
            where: { userId: session.user.id },
            _max: { createdAt: true },
        })
        : [];
    const lastTurnOf = new Map(lastTurns.map((row) => [row.wheelId, row._max.createdAt]));

    return NextResponse.json({
        wheels: wheels.map((wheel) => {
            const rules = {
                cooldown: wheel.cooldown,
                cooldownHours: wheel.cooldownHours,
                cost: wheel.cost,
                roleIds: wheel.roleIds,
                isActive: wheel.isActive,
                hasPrizes: wheel.prizes.length > 0,
            };
            const lastTurn = lastTurnOf.get(wheel.id) ?? null;
            const refusal = refusalFor(rules, {
                signedIn: Boolean(session?.user?.id),
                roleId: user?.roleId ?? null,
                credits: Number(user?.creditBalance ?? 0),
                lastTurn,
            });
            return {
                id: wheel.id,
                slug: wheel.slug,
                name: wheel.name,
                description: wheel.description,
                cost: wheel.cost,
                cooldown: wheel.cooldown,
                cooldownHours: wheel.cooldownHours,
                restricted: wheel.roleIds.length > 0,
                prizes: wheel.prizes,
                canTurn: refusal === null,
                refusal,
                nextTurnAt: nextTurnAt(rules, lastTurn),
            };
        }),
        credits: Number(user?.creditBalance ?? 0),
    }, { headers: PRIVATE });
}
