import { NextRequest, NextResponse } from "next/server";
import { intParam, hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { giftCodeCreateSchema } from "../../lib/validations";
import { randomBytes } from "crypto";

// GET /api/v1/gift-codes - One page of codes, newest first (admin).
//
// This used to read the whole table. Codes are generated in batches - the
// form on the admin screen takes a count - so the table is exactly the kind
// that grows in thousands, and every one of them was serialised into one
// response and rendered into one table on every visit to the page.
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const page = intParam(params, "page", { fallback: 1, min: 1 });
    const perPage = intParam(params, "perPage", { fallback: 50, min: 1, max: 200 });

    /*
     * The term narrows the query rather than the page.
     *
     * A batch of gift codes is generated fifty or a hundred at a time, so this
     * table is long within a week of being used and the only reason anybody
     * opens it is to find one code - usually because a buyer has quoted it.
     * Searching the fifty rows that arrived would answer that the code they
     * are holding was never issued.
     */
    const term = (params.get("q") ?? "").trim();
    const where = term === ""
        ? {}
        : {
            OR: [
                { code: { contains: term, mode: "insensitive" as const } },
                { description: { contains: term, mode: "insensitive" as const } },
            ],
        };

    const [giftCodes, total] = await Promise.all([
        prisma.giftCode.findMany({
            where,
            include: {
                redeemedBy: { select: { id: true, username: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * perPage,
            take: perPage,
        }),
        prisma.giftCode.count({ where }),
    ]);

    return NextResponse.json({
        giftCodes,
        total,
        page,
        pages: Math.max(1, Math.ceil(total / perPage)),
    });
}

// POST /api/v1/gift-codes - Create gift codes (admin)
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = giftCodeCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Value must be positive" }, { status: 400 });
    }
    const { value, description, expiresAt } = parsed.data;
    const count = parsed.data.count ?? 1;

    // Generate multiple gift codes, in one transaction. Creating them one at
    // a time meant a failure on the fiftieth of a hundred answered with an
    // error while fifty live codes, each worth credits, already existed - and
    // the admin, told the request failed, has no list of what was made.
    //
    // 8 bytes, not 4. A code is a bearer secret worth credits and the redeem
    // endpoint says whether a guess exists, so the code space is the second
    // half of that defence: 32 bits is walkable, 64 is not.
    const codes = await prisma.$transaction(
        Array.from({ length: Math.min(count, 100) }, () => prisma.giftCode.create({
            data: {
                code: `GIFT-${randomBytes(8).toString("hex").toUpperCase()}`,
                value,
                description: description || null,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                createdById: session.user.id,
            },
        })),
    );

    return NextResponse.json({ giftCodes: codes, count: codes.length }, { status: 201 });
}
