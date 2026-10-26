import { prisma } from "@/core/lib/db";
import { errorText, log } from "@/core/lib/logger";

/**
 * Generic content revision tracker.
 *
 * Modules call recordRevision() right BEFORE updating or deleting an entity
 * so the previous state is preserved. The (resource, resourceId) pair
 * identifies the entity; resource is a free-form string by convention
 * `<module>.<entity>`.
 *
 * Example usage in a PATCH route:
 *   const existing = await prisma.blogArticle.findUnique({ where: { id } });
 *   if (!existing) return notFound;
 *   await recordRevision("blog.article", id, existing, "update", session.user.id);
 *   await prisma.blogArticle.update({ where: { id }, data: ... });
 *
 * Listing is done by the admin screen through /api/v1/admin/revisions, which
 * pages across every resource. /api/v1/revisions answers for one entity and
 * has no caller in this tree.
 *
 * Nothing restores. The line here used to say "listing & restoring", and
 * `getRevision` sat below described as "for restore preview", read by its own
 * test and nothing else: a preview of something the product does not do. Both
 * are gone rather than left standing as a promise. A revision is a record of
 * what an entity was, and putting it back is a feature somebody would have to
 * decide on, not one to imply.
 */

export async function recordRevision(
    resource: string,
    resourceId: string,
    snapshot: unknown,
    action: "update" | "delete" = "update",
    authorId?: string | null
): Promise<void> {
    try {
        await prisma.revision.create({
            data: {
                resource,
                resourceId,
                data: snapshot as object,
                action,
                authorId: authorId || undefined,
            },
        });
    } catch (err) {
        // Non-fatal - revisions are best-effort. Don't break the actual mutation.
        log.error("[revisions] the revision was not recorded", { resource, resourceId, error: errorText(err) });
    }
}

/** List revisions for a specific entity, newest first. */
export async function listRevisions(resource: string, resourceId: string, limit = 50) {
    return prisma.revision.findMany({
        where: { resource, resourceId },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { author: { select: { id: true, username: true } } },
    });
}

/** Prune revisions older than N days for a resource (background job). */
export async function pruneOldRevisions(daysToKeep = 90): Promise<number> {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const result = await prisma.revision.deleteMany({
        where: { createdAt: { lt: cutoff } },
    });
    return result.count;
}
