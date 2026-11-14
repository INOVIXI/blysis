/**
 * What a module may do with the moderation queue, offered through the SDK.
 *
 * A reviewing module's screens list the kinds and reasons an admin chooses
 * from, show a post it judged, and let an admin take its decision back. None
 * of that may reach a provider directly: a module never imports another, and
 * the queue's rules (an enabled module, a readable kind, a reason the site
 * offers) are core's. So these are the queue screen's own paths, named.
 *
 * `tests/unit/a-module-reaches-the-queue-through-core.test.ts` holds them.
 */
import { prisma } from "@/core/lib/db";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { decide } from "@/core/lib/moderation-decisions";
import { ModuleModerationProviders, type ModeratedText, type ModerationState } from "@/core/generated/module-moderation";

export interface ModerationKind {
    id: string;
    /** English, as the manifest gives it; `labelKey` is its translation in the admin namespace. */
    label: string;
    labelKey?: string;
    /** Whether its module can show what was written, which a reviewer needs. */
    readable: boolean;
}

async function enabledProviders(): Promise<typeof ModuleModerationProviders> {
    const states = await getModuleStates();
    return ModuleModerationProviders.filter((p) => isEnabledIn(states, p.module));
}

export async function moderationKinds(): Promise<ModerationKind[]> {
    const providers = await enabledProviders();
    return Promise.all(
        providers.map(async (p) => {
            let readable = false;
            try {
                readable = typeof (await p.loader()).default.read === "function";
            } catch {
                // A module that will not load reads as one that cannot read.
            }
            return { id: p.id, label: p.label, ...(p.labelKey ? { labelKey: p.labelKey } : {}), readable };
        }),
    );
}

/** What was written, for a kind that is on and can read; nothing otherwise. */
export async function readModerated(kind: string, ids: string[]): Promise<ModeratedText[]> {
    if (ids.length === 0) return [];
    const provider = (await enabledProviders()).find((p) => p.id === kind);
    if (!provider) return [];
    const impl = (await provider.loader()).default;
    return impl.read ? impl.read(ids) : [];
}

export interface ModerateInput {
    kind: string;
    ids: string[];
    state: ModerationState;
    /** Required, and one of the site's enabled reasons, when rejecting. */
    reasonId?: string | null;
    note?: string | null;
    /** The person deciding. */
    decidedById: string;
}

export type ModerateResult =
    | { ok: true; affected: string[] }
    | { ok: false; code: "unknown_kind" | "reason_required" | "reason_unknown" };

/** A person's decision, by the rules the queue screen applies. */
export async function moderate(input: ModerateInput): Promise<ModerateResult> {
    const provider = (await enabledProviders()).find((p) => p.id === input.kind);
    if (!provider) return { ok: false, code: "unknown_kind" };

    const rejecting = input.state === "REJECTED";
    if (rejecting) {
        if (!input.reasonId) return { ok: false, code: "reason_required" };
        const reason = await prisma.moderationReason.findUnique({ where: { id: input.reasonId }, select: { enabled: true } });
        if (!reason?.enabled) return { ok: false, code: "reason_unknown" };
    }

    const impl = (await provider.loader()).default;
    const { affected } = await decide(
        { id: provider.id, impl },
        {
            ids: input.ids,
            state: input.state,
            reasonId: rejecting ? input.reasonId : null,
            note: input.note ?? null,
            decidedById: input.decidedById,
        },
    );
    return { ok: true, affected };
}
