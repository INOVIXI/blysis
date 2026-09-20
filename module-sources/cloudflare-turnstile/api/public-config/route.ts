import { NextResponse } from "next/server";
import { prisma } from "@/core/sdk/server";

/**
 * What the widget needs to draw itself, and nothing more.
 *
 * The admin endpoint next door returns the whole config and requires an admin
 * session. This one is deliberately public, because it is read from the login
 * page by someone who has not signed in yet - so it returns the site key,
 * which Cloudflare publishes in the page markup anyway, and the two switches
 * that say which forms the widget belongs on. The secret key is never in the
 * response shape at all: it is read by name, not spread.
 */
const SETTING_KEY = "cloudflare_turnstile_config";

export const dynamic = "force-dynamic";

export async function GET() {
    const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const value = (setting?.value ?? {}) as Record<string, unknown>;
    /*
     * The forms the widget belongs on, as one list. The two booleans are
     * folded into it rather than sent beside it: the widget asks "am I on
     * here?" about whatever form it is drawn in, and an install that predates
     * the list must get the same answer as one that has it.
     */
    const points = new Set(Array.isArray(value.points) ? (value.points as string[]) : []);
    if (value.enableOnLogin === true) points.add("login");
    if (value.enableOnRegister === true) points.add("register");

    return NextResponse.json({
        siteKey: typeof value.siteKey === "string" ? value.siteKey : "",
        points: [...points],
    });
}
