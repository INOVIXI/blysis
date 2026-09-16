import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { staffMemberSchema } from "../lib/validations";
import { readStaff } from "../lib/read-staff";

// The read and what counts as online live in lib/read-staff.ts, because the
// page renders the team on the server now and the two must not disagree.
export async function GET(request: NextRequest) {
    const onlineOnly = new URL(request.url).searchParams.get("online") === "1";
    return NextResponse.json({ members: await readStaff(onlineOnly) });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = staffMemberSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: "Name and role required" }, { status: 400 });
    }
    const { name, role, avatar, userId, order } = parsed.data;

    const member = await prisma.staffMember.create({
        data: { name, role, avatar: avatar || null, userId: userId || null, order: order || 0 },
    });
    return NextResponse.json({ member }, { status: 201 });
}
