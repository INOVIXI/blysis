import { prisma } from "@/core/sdk/server";

/**
 * Does `/u/<username>` name anybody?
 *
 * The page fetches the profile in the browser, so without this the answer
 * arrived after a 200 and a rendered shell. Matching is case-insensitive
 * because the route that serves the page matches that way too.
 */
export default async function memberExists(params: Record<string, string | string[]>): Promise<boolean> {
    const raw = params.username;
    const username = Array.isArray(raw) ? raw[0] : raw;
    if (!username) return false;
    const user = await prisma.user.findFirst({
        where: { username: { equals: username, mode: "insensitive" } },
        select: { id: true },
    });
    return user !== null;
}
