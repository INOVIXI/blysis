import { NextRequest, NextResponse } from "next/server";
import { departmentsOpenTo, fieldsOf } from "../../../lib/departments";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { ticketDepartmentSchema } from "../../../lib/validations";

// GET /api/v1/tickets/departments - List departments
export async function GET(request: NextRequest) {
    const session = await auth();
    const adminCheck = session?.user?.id ? await hasPermission(session.user.id, "tickets.departments") : false;

    // An operator sees everything, including what they switched off: this is
    // the screen they manage departments from.
    if (adminCheck) {
        const departments = await prisma.ticketDepartment.findMany({
            orderBy: { order: "asc" },
            // A ceiling even here: an operator adds these by hand, but a
            // screen that reads a whole table is the one that stops working
            // on the site that grew.
            take: 200,
        });
        return NextResponse.json({ departments });
    }

    /*
     * A member sees the ones they may open a ticket in, with the extra
     * questions each one asks. Both in one answer: the form needs the
     * questions the moment the department is picked, and a second request per
     * department would be a request per click.
     *
     * The create endpoint asks again. This list is what the form draws; it is
     * not what decides.
     */
    const openable = await departmentsOpenTo(session?.user?.role ?? null);
    const departments = await Promise.all(
        openable.map(async (entry) => ({
            ...entry.department,
            canOpen: entry.access.post,
            fields: await fieldsOf(entry.department.id),
        })),
    );

    return NextResponse.json({ departments });
}

// POST /api/v1/tickets/departments - Create department (admin)
export async function POST(request: NextRequest) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "tickets.departments");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = ticketDepartmentSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0].message },
            { status: 400 }
        );
    }
    const { name, description, color, order } = parsed.data;

    const department = await prisma.ticketDepartment.create({
        data: {
            name,
            description,
            color,
            order: order || 0,
        },
    });

    return NextResponse.json(department, { status: 201 });
}
