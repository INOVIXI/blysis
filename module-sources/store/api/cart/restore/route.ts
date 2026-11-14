import { NextRequest, NextResponse } from "next/server";
import { log, moduleSettings, prisma, rateLimitForRoleAsync, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { restoreCartFromOrder } from "../../../lib/cart-restore";
import { z } from "zod";

const restoreSchema = z.object({
    orderId: z.string().min(1).max(64),
});

// POST /api/v1/store/cart/restore - Fill the basket again from an unpaid order of mine
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // The same budget as every other basket write: this is one.
        const allowed = await rateLimitForRoleAsync(
            `cart-write:${session.user.id}`,
            { maxRequests: 60, windowMs: 60_000 },
            session.user.role,
        );
        if (!allowed) {
            return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
        }

        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = restoreSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
        }

        const { maxCartItems } = await moduleSettings<{ maxCartItems: number }>("store");
        const restored = await restoreCartFromOrder(prisma, session.user.id, validation.data.orderId, maxCartItems);
        if (restored === null) {
            // Somebody else's order and a paid one read the same: nothing to
            // pick up, and nothing said about whose it is.
            return NextResponse.json({ error: "Nothing to pick up again", code: "restore_nothing" }, { status: 404 });
        }
        return NextResponse.json({ restored });
    } catch (error) {
        log.error("Restore cart error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
