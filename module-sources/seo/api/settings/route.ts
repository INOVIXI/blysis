import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";

/**
 * `seo_default_title` and `seo_default_description` used to be here. They were
 * a second copy of `site_name` and `site_description`, written by this screen
 * and read by nothing, while the real pair reaches every page on the site.
 * Two boxes for one setting, one of which does nothing, is worse than one.
 */
const SEO_KEYS = [
    "seo_title_template",
    "seo_keywords",
    "seo_default_og_image",
    "seo_google_verification",
    "seo_bing_verification",
] as const;

export async function GET() {
    try {
        const settings = await prisma.setting.findMany({
            where: { key: { in: [...SEO_KEYS] } },
        });

        const result: Record<string, string> = {};
        for (const s of settings) {
            result[s.key] = s.value as string;
        }

        return NextResponse.json({ settings: result });
    } catch {
        return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;

        const schema = z.object({
            seo_title_template: z.string().max(200).optional(),
            seo_keywords: z.string().max(500).optional(),
            seo_default_og_image: z.string().max(2000).optional(),
            seo_google_verification: z.string().max(200).optional(),
            seo_bing_verification: z.string().max(200).optional(),
        });

        const validation = schema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
        }

        const data = validation.data;

        // One transaction: this form sends every SEO key at once, and a
        // failure partway used to leave the title written and the description
        // not, under a message that said nothing had been saved.
        await prisma.$transaction(
            SEO_KEYS
                .filter((key) => data[key] !== undefined)
                .map((key) => prisma.setting.upsert({
                    where: { key },
                    update: { value: data[key] as string, module: "seo" },
                    create: { key, value: data[key] as string, module: "seo" },
                })),
        );

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }
}
