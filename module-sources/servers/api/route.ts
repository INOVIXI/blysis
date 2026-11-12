import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, encryptSecret, isAdmin, prisma, readJsonBody, saveContentTranslations, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { SERVER_TEXT, TRANSLATED_FIELDS, serverCreateSchema } from "../lib/validations";
import { SERVER_PUBLIC_FIELDS } from "../lib/server-fields";

/**
 * GET /api/v1/servers - what the status widget asks, and what the panel lists.
 *
 * The widget's answer is the servers that are on. The panel read the same
 * answer, which meant the switch labelled "Active" removed the row from the
 * only screen that could switch it back on: an operator who took a server
 * down for the season had to go into the database to get it back.
 *
 * `scope=admin` is every server, in the order they are drawn in, and refused
 * to anybody who is not an operator - a server somebody turned off is a host
 * they took off the site, with every language of its name and description
 * for the editor. A visitor's answer is in `?locale=`, and the original where
 * the admin wrote no translation. The password and the port it opens stay out
 * of both answers; see `server-fields.ts`.
 */
export async function GET(request: NextRequest) {
    if (new URL(request.url).searchParams.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

        const all = await prisma.gameServer.findMany({
            orderBy: { order: "asc" },
            select: SERVER_PUBLIC_FIELDS,
        });
        return NextResponse.json({ servers: await attachContentTranslations(prisma, SERVER_TEXT, all) });
    }

    const servers = await prisma.gameServer.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: SERVER_PUBLIC_FIELDS,
    });
    const locale = new URL(request.url).searchParams.get("locale") ?? "";
    return NextResponse.json({ servers: await translateContent(prisma, SERVER_TEXT, servers, ["name", "description"], locale) });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = serverCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const fields = parsed.data;

    const server = await prisma.$transaction(async (tx) => {
        const created = await tx.gameServer.create({
            data: {
                name: fields.name,
                type: fields.type || "minecraft",
                host: fields.host,
                port: fields.port || 25565,
                rconPort: fields.rconPort || null,
                // RCON password is stored encrypted at rest (AES-256-GCM).
                // Read back via decryptSecret() when the connection is opened.
                rconPassword: fields.rconPassword ? encryptSecret(fields.rconPassword) : null,
                queryPort: fields.queryPort || null,
                isDefault: fields.isDefault || false,
                isActive: fields.isActive ?? true,
                order: fields.order || 0,
                description: fields.description || null,
                image: fields.image || null,
            },
            select: SERVER_PUBLIC_FIELDS,
        });
        if (translations.value) await saveContentTranslations(tx, { ...SERVER_TEXT, recordId: created.id }, translations.value);
        return created;
    });
    return NextResponse.json({ server }, { status: 201 });
}
