import { prisma } from "@/core/sdk/server";

/**
 * Does `/page/<slug>` name a published page? Same condition as the API the
 * page calls: a deactivated page is a 404, not an empty frame.
 *
 * A page that exists is answered with its title, which core puts in the tab:
 * every page shares the one route, so the route's own name made each of them
 * "Page".
 */
export default async function customPageExists(
    params: Record<string, string | string[]>,
): Promise<boolean | { title: string }> {
    const raw = params.slug;
    const slug = Array.isArray(raw) ? raw[0] : raw;
    if (!slug) return false;
    const page = await prisma.customPage.findFirst({
        where: { OR: [{ slug }, { id: slug }], isActive: true },
        select: { id: true, title: true },
    });
    return page ? { title: page.title } : false;
}
