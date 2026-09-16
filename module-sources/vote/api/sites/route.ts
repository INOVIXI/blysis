import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { readVoteSites } from "../../lib/read-sites";
import { auth } from "@/core/sdk/auth";
import { voteSiteCreateSchema } from "../../lib/validations";

// GET /api/v1/vote - List vote sites
// The read lives in lib/read-sites.ts, because the page renders the list on
// the server now and the two must not drift.
export async function GET() {
    return NextResponse.json({ sites: await readVoteSites() });
}

// POST /api/v1/vote - Create vote site (admin)
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = voteSiteCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Name and URL required" }, { status: 400 });
    }
    const { name, url, icon } = parsed.data;

    const site = await prisma.voteSite.create({
        data: { name, url, icon: icon || null },
    });

    return NextResponse.json({ site }, { status: 201 });
}
