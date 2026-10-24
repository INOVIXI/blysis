import { NextRequest, NextResponse } from "next/server";
import { readMember } from "../../lib/read-member";

type RouteParams = { params: Promise<{ username: string }> };

// GET /api/v1/members/[username] - Public member profile, read as the page reads it.
export async function GET(_request: NextRequest, { params }: RouteParams) {
    const { username } = await params;
    const member = await readMember(username);
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json({ member });
}
