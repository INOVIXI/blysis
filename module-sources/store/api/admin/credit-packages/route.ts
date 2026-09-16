import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { creditPackageSchema } from "../../../lib/validations";

/**
 * The packages an operator sells credits in.
 *
 * Separate from the public listing, which answers only what is on sale: this
 * one is how an operator sees the one they just switched off.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const packages = await prisma.creditPackage.findMany({
        orderBy: [{ order: "asc" }, { price: "asc" }],
        take: 100,
    });
    return NextResponse.json({ packages }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = creditPackageSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const pack = await prisma.creditPackage.create({ data: parsed.data });
    await logActivity({
        userId: session.user.id,
        action: "store.credit_package.created",
        entity: "credit_package",
        entityId: pack.id,
        metadata: { name: pack.name, credits: pack.credits, bonusCredits: pack.bonusCredits },
    }).catch(() => {});

    return NextResponse.json({ package: pack }, { status: 201 });
}
