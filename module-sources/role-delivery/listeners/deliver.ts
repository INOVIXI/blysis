import { prisma, grantRole } from "@/core/sdk/server";
import type { HookHandlerFor } from "@/core/sdk";
import { planGrant } from "../lib/grant-plan";
import { readRolePayload } from "../lib/payload";

/**
 * Handing the rank over, once the credits have moved.
 *
 * The market has already paid the seller by the time this runs, so a failure
 * here is a sale somebody unpicks by hand. Everything that can be decided
 * before writing is decided in `grant-plan.ts`; what is left is reading the
 * two rows the decision needs and making the two writes it asks for.
 *
 * Both writes go in one transaction. A member whose role changed but whose
 * grant did not is a rank nothing will ever take back, and that is a worse
 * state to be left in than a failed delivery: the operator can see a failed
 * delivery.
 */
const deliver: HookHandlerFor<"marketplace.deliver", "filter"> = async (outcome, delivery) => {
    // Somebody else's kind. Answering for it would be this module claiming a
    // sale it knows nothing about.
    if (delivery.kind !== "role") return outcome;

    const wanted = readRolePayload(delivery.payload);
    if (!wanted) return { handled: true, error: "That listing does not say which rank." };

    const [buyer, role, standing] = await Promise.all([
        prisma.user.findUnique({ where: { id: delivery.buyerId }, select: { id: true } }),
        prisma.role.findUnique({ where: { id: wanted.roleId }, select: { id: true } }),
        prisma.userRole.findUnique({
            where: { userId_roleId: { userId: delivery.buyerId, roleId: wanted.roleId } },
            select: { expiresAt: true },
        }),
    ]);

    // The buyer's account can go between paying and this running.
    if (!buyer) return { handled: true, error: "That account is no longer here." };

    const plan = planGrant(
        wanted,
        standing,
        { existingRoleIds: new Set(role ? [role.id] : []) },
        new Date(),
    );

    if ("refuse" in plan) {
        return { handled: true, error: REFUSALS[plan.refuse] };
    }

    // Core writes the row and brings the displayed role up to date. A rank is
    // added to what the buyer already holds: the shape this replaces swapped
    // their one role for it, so buying a rank could take a moderator's job
    // away for thirty days. The label is free text core never interprets.
    await grantRole(delivery.buyerId, plan.grant.roleId, {
        expiresAt: plan.grant.expiresAt,
        source: "marketplace:role",
    });

    return { handled: true, error: null };
};

const REFUSALS: Record<"unknown_role" | "bad_duration" | "already_held", string> = {
    unknown_role: "That rank no longer exists.",
    bad_duration: "That listing does not say for how long.",
    already_held: "The buyer already holds that rank for good.",
};

export default deliver;
