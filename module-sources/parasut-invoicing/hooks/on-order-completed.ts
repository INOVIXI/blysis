/**
 * A paid order becomes an invoice.
 *
 * The claim row goes in before the call, because this hook arrives more than
 * once in normal operation - a retried gateway callback, an operator marking
 * an order paid that a webhook was already settling - and a legal invoice
 * issued twice has to be cancelled by hand. `createMany` with `skipDuplicates`
 * against the unique key on the order is the claim: it either wrote the row
 * or somebody else already has it.
 *
 * An order that cannot be invoiced is recorded with the reason rather than
 * dropped. An operator installed this because they have to issue invoices, so
 * an order they cannot is the one thing they need to be shown.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log, moduleSettings, prisma, readSettingStrings } from "@/core/sdk/server";
import { whatToDoWith } from "../lib/decide";
import type { InvoiceStatus } from "../lib/invoice-state";
import { contactPayload, invoicePayload } from "../lib/invoice-payload";
import { createRecord, isConfigured, ProviderError, withProvider } from "../lib/client";
import { sendLegalDocument } from "../lib/send-document";
import { invoiceRate, recordedTax, sendsByItself } from "../lib/recorded-tax";

/**
 * The shop's tax rate, read where the store keeps it.
 *
 * Module settings, not a `Setting` row: the rate moved there when the
 * payments screen stopped owning it, and reading the old key would have put
 * zero percent on every invoice - a legally wrong document that looks fine.
 */
/**
 * Whether the operator wants the document sent without being asked.
 *
 * Off unless they say so. Recording a sale is reversible here; putting a
 * document in front of the tax authority is not.
 */
async function sendsDocumentAutomatically(): Promise<boolean> {
    const settings = await moduleSettings<{ sendEDocument?: boolean }>("parasut-invoicing");
    return settings.sendEDocument === true;
}

/** Where the sale happened, which an e-Arşiv has to carry. */
async function shopUrl(): Promise<string> {
    const values = await readSettingStrings(["site_url"]);
    return values.site_url ?? "";
}

async function taxRate(): Promise<number> {
    const settings = await moduleSettings<{ taxRate?: number }>("store");
    const rate = Number(settings.taxRate);
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

const onOrderCompleted: HookHandlerFor<"store.order.completed", "action"> = async (payload) => {
    if (!(await isConfigured())) return;

    // The event carries the order, the buyer's address and their email. It
    // used to be read back out of the shop's own table here, which is a
    // module reaching into another module's data for what it was handed.
    const order = payload;
    // What this sale was charged, when the store recorded it: a sale abroad
    // may carry another country's rate or none at all.
    const charged = recordedTax(order.metadata);

    const existing = await prisma.issuedInvoice.findUnique({ where: { orderId: order.id } });
    const decision = whatToDoWith(
        { id: order.id, status: order.status ?? "", billingDetails: order.billingDetails, total: order.total },
        existing ? { status: existing.status as InvoiceStatus } : null,
    );

    if ("skip" in decision) return;

    if ("hold" in decision) {
        await prisma.issuedInvoice.upsert({
            where: { orderId: order.id },
            create: { orderId: order.id, status: "failed", reason: "No invoice details on the order" },
            update: { status: "failed", reason: "No invoice details on the order" },
        });
        return;
    }

    // The claim. Racing completions both reach here; only one writes.
    const claimed = await prisma.issuedInvoice.createMany({
        data: [{ orderId: order.id, status: "pending" }],
        skipDuplicates: true,
    });
    if (claimed.count === 0) {
        // Somebody else holds it, unless the row is a previous failure this
        // run is retrying.
        const retry = await prisma.issuedInvoice.updateMany({
            where: { orderId: order.id, status: "failed" },
            data: { status: "pending", reason: null },
        });
        if (retry.count === 0) return;
    }

    try {
        const remote = await withProvider(async (config, token) => {
            const contact = await createRecord(
                config,
                token,
                "contacts",
                contactPayload(decision.billing, order.buyerEmail ?? ""),
            );
            return createRecord(
                config,
                token,
                "sales_invoices",
                invoicePayload({
                    contactId: contact.id,
                    order: {
                        orderNumber: order.orderNumber,
                        currency: order.currency ?? "",
                        taxRate: invoiceRate(charged, await taxRate()),
                        lines: order.items.map((item) => ({
                            name: item.name,
                            quantity: item.quantity,
                            unitAmount: Number(item.price),
                        })),
                    },
                    issuedOn: new Date(),
                }),
            );
        });

        const invoiceNumber = typeof remote.attributes.invoice_no === "string" ? remote.attributes.invoice_no : null;
        await prisma.issuedInvoice.update({
            where: { orderId: order.id },
            data: {
                // What was done, not what it means: a sales invoice exists in
                // the accounting service. Whether the tax authority has a
                // document for it is a second question, and `legalDocument`
                // is where that one is answered.
                status: "recorded",
                remoteId: remote.id,
                remoteNumber: invoiceNumber,
                // What a document will need if it is asked for later.
                buyerTaxNumber: decision.billing.taxNumber,
                paymentMethod: order.paymentMethod ?? null,
                paidAt: new Date(),
                issuedAt: new Date(),
                reason: null,
                attempts: { increment: 1 },
            },
        });

        // And the document, if the operator has asked for that to happen by
        // itself. Off by default: a document in front of the tax authority is
        // cancelled by a procedure rather than a delete, so an operator turns
        // this on knowing what it does, or presses the button per sale.
        if (sendsByItself(charged) && (await sendsDocumentAutomatically())) {
            await sendLegalDocument({
                orderId: order.id,
                salesInvoiceId: remote.id,
                taxNumber: decision.billing.taxNumber,
                shopUrl: await shopUrl(),
                paymentMethod: order.paymentMethod ?? null,
                paidAt: new Date(),
                invoiceNumber,
            });
        }
    } catch (err) {
        const reason = err instanceof ProviderError ? err.message : "The invoice could not be issued";
        // The order id, never the payload: it carries the buyer's address and
        // tax number.
        log.error("[parasut-invoicing] issuing an invoice failed", { orderId: order.id });
        await prisma.issuedInvoice.update({
            where: { orderId: order.id },
            data: { status: "failed", reason, attempts: { increment: 1 } },
        });
    }
};

export default onOrderCompleted;
