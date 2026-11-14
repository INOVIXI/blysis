/**
 * GET /api/v1/ai-moderation/admin/options?locale= - what the settings screen
 * offers: the kinds a reviewer can read, and the site's rejection reasons in
 * the reader's language. A kind whose module cannot show what was written is
 * left out, since core never hands it to a reviewer.
 */
import { NextRequest, NextResponse } from "next/server";
import { moderationKinds, moderationReasons } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../lib/admin";

export async function GET(request: NextRequest) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

    const locale = request.nextUrl.searchParams.get("locale") ?? "";
    const [kinds, reasons] = await Promise.all([moderationKinds(), moderationReasons(locale)]);
    return NextResponse.json({ kinds: kinds.filter((k) => k.readable), reasons });
}
