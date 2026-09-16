import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { PRIVATE, refuseUnlessInvited } from "../../../lib/request";
import { integerFor } from "../../../lib/integrator-ids";

/*
 * @provider-callback: this integrator signs in with a shared secret in a
 * `token` header rather than a session, so there is no `auth()` here to find.
 * `refuseUnlessInvited` compares it against the operator's secret in constant
 * time (`lib/token.ts`, `crypto.timingSafeEqual` over digests, and a blank
 * secret refuses everybody), and the handler below calls it first.
 */

/**
 * POST /api/v1/birfatura/payment-methods - how this shop takes money.
 *
 * Asked of the payment contract rather than read off the orders. Distinct
 * payment methods over every order ever placed is a full scan of the one
 * table that grows without bound, and it answers with history rather than
 * with what the shop can take today: a gateway uninstalled last year would
 * still be on the list.
 */
export async function POST(request: NextRequest) {
    const refused = await refuseUnlessInvited(request);
    if (refused) return refused;

    const gateways = await applyFiltersAsync("payment.providers", [], { currency: "TRY" });
    const methods = gateways.map((gateway) => ({ Id: gateway.id, Value: gateway.label }));

    // The wallet the store runs itself is not a gateway and answers no
    // filter, but an order really can be paid with it.
    methods.push({ Id: "credits", Value: "Store credits" });

    return NextResponse.json({ PaymentMethods: methods }, { headers: PRIVATE });
}
