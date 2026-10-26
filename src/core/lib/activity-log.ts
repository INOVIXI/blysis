import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { auth } from "@/core/lib/auth";
import { errorText, log } from "@/core/lib/logger";

/**
 * Record a single audit event. The schema stores `metadata` as a Json
 * column - previous versions cast the object to string which round-tripped
 * as a stringified blob rather than a queryable JSON document, making
 * downstream `prisma.activityLog.findMany({ where: { metadata: { path: [...], ... } } })`
 * queries fail silently. Now the object is handed to Prisma directly so
 * Prisma serializes it correctly.
 *
 * When the supplied userId belongs to an active impersonation session
 * (`session.user.originalUserId` is set), we rewrite the row so the REAL
 * admin is recorded as the actor and the impersonated user id goes into
 * `metadata.impersonating`. Without this a compromised admin could launder
 * mutations through a victim's account and the audit trail would blame
 * the victim. Callers who already handle this (rare) can pass
 * `__impersonationChecked: true` in metadata to skip the lookup.
 */
export async function logActivity(params: {
    userId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
}) {
    try {
        let userId = params.userId || null;
        const metadata: Record<string, unknown> = { ...(params.metadata ?? {}) };
        const alreadyChecked = metadata.__impersonationChecked === true;
        delete metadata.__impersonationChecked;

        if (userId && !alreadyChecked) {
            try {
                const session = await auth();
                const realAdmin = session?.user?.originalUserId;
                const actingAs = session?.user?.id;
                if (realAdmin && actingAs === userId) {
                    metadata.impersonating = userId;
                    userId = realAdmin;
                }
            } catch {
                // `auth()` can throw outside a request context (e.g. cron,
                // background tasks). In that case there's no impersonation
                // to unwind - record the event as-is.
            }
        }

        await prisma.activityLog.create({
            data: {
                userId,
                action: params.action,
                entity: params.entity || null,
                entityId: params.entityId || null,
                metadata:
                    Object.keys(metadata).length > 0
                        ? (metadata as Prisma.InputJsonValue)
                        : Prisma.JsonNull,
                ipAddress: params.ipAddress || null,
            },
        });
    } catch (err) {
        log.error("[activity-log] the entry was not recorded", { action: params.action, error: errorText(err) });
    }
}
