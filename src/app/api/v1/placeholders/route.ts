import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/core/lib/api-utils";
import { resolvePlaceholders } from "@/core/lib/placeholders";

/**
 * GET /api/v1/placeholders
 *
 * Every site placeholder's value, for the page that rendered before some of
 * them were ready. Public, because the page that shows them is; a placeholder
 * answers the same for everybody by contract. Waits longer than a page render
 * may, and is rate limited like the rest of the public API, since one request
 * reaches every module that declares one.
 */
export const GET = withRateLimit("placeholders", async (_request: NextRequest) => {
    const { values } = await resolvePlaceholders({ budgetMs: 3000 });
    return NextResponse.json({ values });
});
