/**
 * Public server status.
 *
 * The flat fields describe the default server and are what this endpoint has
 * always returned; a theme or a script written against the old shape keeps
 * working. `servers` is the new part: every active server, each asked in the
 * protocol it speaks, with its name and description in `?locale=` and the
 * original where the admin wrote no translation.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, translateContent } from "@/core/sdk/server";
import { getServerStatus, getAllServerStatuses } from "../../lib/server-query";
import { SERVER_TEXT } from "../../lib/validations";

export async function GET(request: NextRequest) {
    const locale = new URL(request.url).searchParams.get("locale") ?? "";
    const [status, servers] = await Promise.all([getServerStatus(), getAllServerStatuses()]);
    return NextResponse.json({ ...status, servers: await translateContent(prisma, SERVER_TEXT, servers, ["name", "description"], locale) });
}
