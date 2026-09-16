import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { readJsonBody, siteTimeZone } from "@/core/sdk/server";
import { z } from "zod";
import { PRIVATE, refuseUnlessInvited } from "../../../lib/request";
import { orderAnswer } from "../../../lib/order-answer";
import { taxSetup } from "../../../lib/setup";
import { readTurkishDateTime } from "../../../lib/turkish-date";
import { statusNameFor } from "../../../lib/integrator-ids";


/*
 * @provider-callback: this integrator signs in with a shared secret in a
 * `token` header rather than a session, so there is no `auth()` here to find.
 * `refuseUnlessInvited` compares it against the operator's secret in constant
 * time (`lib/token.ts`, `crypto.timingSafeEqual` over digests, and a blank
 * secret refuses everybody), and every handler below calls it first.
 */
/**
 * POST /api/v1/birfatura/orders - the sales in a window, ready to be invoiced.
 *
 * The integrator calls this on a schedule with a date range and the state it
 * was told to invoice. Everything it needs is in the answer, including the
 * lines, because a second call per order would turn a nightly run into a
 * thousand requests.
 *
 * An order with nobody to invoice is left out rather than sent with a name
 * taken from the account: an invoice made out to a username is a wrong legal
 * document and this service will issue it without complaint.
 */
/**
 * The states this shop reaches. Named here rather than taken as a free
 * string: the value goes straight into the query, and an unknown one is a
 * caller asking a question the shop cannot answer rather than an empty list
 * that reads like "no sales that day".
 */
const askSchema = z.object({
    startDateTime: z.string().max(40).optional(),
    endDateTime: z.string().max(40).optional(),
    /*
     * An integer, which is what the published schema says and what the
     * integrator echoes back from `/api/orderStatus`.
     *
     * It used to be read as the shop's own enum name - "COMPLETED" - so the
     * three endpoints agreed with each other and with nothing in the document.
     * A string is still accepted because that is what this module published
     * for as long as it did: an integrator set up against the old answer keeps
     * working until it refreshes its mapping.
     */
    orderStatusId: z.union([z.number().int(), z.string().max(32)]).optional(),
});

/** A window this endpoint will answer for. */
const MAX_ORDERS = 500;



export async function POST(request: NextRequest) {
    const refused = await refuseUnlessInvited(request);
    if (refused) return refused;

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = askSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: PRIVATE });
    }

    // `dd.MM.yyyy HH:mm:ss`, in the shop's own time zone, because that is
    // what the integrator sends and what midnight means to the shop.
    // `new Date(...)` read the first of July as the seventh of January and
    // the sixteenth as nothing at all.
    const zone = await siteTimeZone();
    const from = readTurkishDateTime(parsed.data.startDateTime, zone);
    const until = readTurkishDateTime(parsed.data.endDateTime, zone);
    if (!from || !until) {
        return NextResponse.json(
            { Success: false, Message: "startDateTime and endDateTime must be dd.MM.yyyy HH:mm:ss" },
            { status: 400, headers: PRIVATE },
        );
    }
    // Paid unless the integrator asked for another state. An unpaid order is
    // not a sale, and invoicing one is a document to cancel later.
    const status = statusNameFor(parsed.data.orderStatusId);
    if (!status) {
        return NextResponse.json(
            { Success: false, Message: "orderStatusId is not one this shop published" },
            { status: 400, headers: PRIVATE },
        );
    }

    // The shop answers for its own sales. This used to be a query against
    // `Order` written here, which is an invoicing module knowing the shop's
    // status vocabulary, its line items and where a buyer's email lives.
    const orders = await applyFiltersAsync("store.orders.collect", [], {
        status,
        from,
        until,
        limit: MAX_ORDERS,
    });

    const tax = await taxSetup();
    const answers = orders
        .map((order) =>
            orderAnswer(
                {
                    id: order.id,
                    number: order.number ?? 0,
                    orderNumber: order.orderNumber,
                    subtotal: order.subtotal ?? order.total,
                    discount: order.discount ?? 0,
                    createdAt: order.createdAt ? new Date(order.createdAt) : new Date(),
                    currency: order.currency ?? "",
                    total: order.total,
                    userId: order.userId,
                    email: order.buyerEmail ?? null,
                    paymentMethod: order.paymentMethod ?? null,
                    billingDetails: order.billingDetails,
                    items: order.items,
                },
                tax,
            ),
        )
        .filter((answer): answer is Record<string, unknown> => answer !== null);

    return NextResponse.json({ Orders: answers }, { headers: PRIVATE });
}
