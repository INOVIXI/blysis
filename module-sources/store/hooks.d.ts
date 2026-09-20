/**
 * Payload contract for the hooks this module fires. See blog/hooks.d.ts for
 * why the emitter owns these shapes and what widening/narrowing means.
 *
 * `total` is a Prisma Decimal, which is a runtime object rather than a number -
 * it is typed `unknown` deliberately so a listener has to convert it (with
 * `Number(...)`) instead of formatting an object into a message.
 */
interface CouponRequest {
    /** The caller's transaction; the coupon joins whatever else it is doing. */
    tx: import("@/core/sdk/server").PrismaTransaction;
    /** Unique. The caller mints it because it usually has to show it first. */
    code: string;
    description?: string | null;
    /** A fixed amount off. Percentages are the shop's own business. */
    amount: number;
    /** How many times it may be used, once being the usual answer. */
    usageLimit?: number;
}

interface CouponIssued {
    issued: boolean;
}

interface ProductGrantRequest {
    /** The caller's transaction; the grant joins whatever else it is doing. */
    tx: import("@/core/sdk/server").PrismaTransaction;
    /** Who is being given the thing. */
    userId: string;
    /** Which thing, as `grantable.options` named it. */
    productId: string;
    /** How many. One unless the caller says otherwise. */
    quantity?: number;
    /** What to write on the row, so a member can see where it came from. */
    reason?: string | null;
}

interface ProductGranted {
    granted: boolean;
    /** What the thing is called, for whatever tells the winner. */
    name?: string;
}

/**
 * Something a module can hand somebody, offered by whoever owns it.
 *
 * A module that gives prizes has no vocabulary for what a prize is made of,
 * and must not grow one: the wheel knew about credits and discounts and
 * nothing else, so a prize of any other kind was drawn, announced and
 * handed over as thin air.
 */
interface Grantable {
    /** Opaque to the caller. It travels back in `product.grant`. */
    id: string;
    /** What a person calls it. Already the operator's own words. */
    label: string;
    /** A second line: a price, a category, whatever tells two apart. */
    hint?: string | null;
}

declare global {
    interface BlysisHookPayloads {
        "store.order.created": StoreOrderHookPayload;
        "store.order.completed": StoreOrderHookPayload;
        "store.product.created": { id: string; name: string; slug: string };
    }

    /**
     * The payment contract.
     *
     * A payment gateway is a module, not a branch in this one. The store knows
     * how to price an order and what to do once it is paid for; it knows
     * nothing about Stripe, PayPal or iyzico, and asks through these six
     * filters instead.
     *
     * Filters rather than actions in both directions, deliberately. The store
     * asking "who can take money?" and "start this payment" are questions with
     * answers. The gateway saying "this was paid" is a question too: it needs
     * to know whether anybody recorded it, because a webhook that goes
     * unhandled must be failed so the provider retries rather than acknowledged
     * and lost. An action would throw that answer away.
     *
     * The shapes live here, in the store, even though gateways answer three of
     * them: every gateway depends on the store, so this file is always present,
     * and one published contract beats each gateway inventing its own.
     */
    interface BlysisFilterPayloads {
        /** Whether a coupon was created for the code the caller minted. */
        "coupon.issue": CouponIssued;
        /** Whether the thing was handed over, and what it is called. */
        "product.grant": ProductGranted;
        /** Everything any module will hand over on request. */
        "grantable.options": Grantable[];
        /** The sales somebody is collecting, oldest first. */
        "store.orders.collect": StoreOrderHookPayload[];
        /** The shop's own id for an order somebody named, or null for none. */
        "store.order.resolve": string | null;
        /** Which gateways can take this currency right now. */
        "payment.providers": PaymentProviderSummary[];
        /** Where to send the buyer, once a gateway has started the payment. */
        "payment.session": PaymentSessionResult;
        /** Whether anybody recorded the money that arrived. */
        "payment.settled": PaymentOutcome;
        /** Whether anybody cancelled the order the buyer walked away from. */
        "payment.voided": PaymentOutcome;
        /** Whether anybody recorded the money going back. */
        "payment.refunded": PaymentOutcome;
        /** Whether anybody recorded the change to the plan. */
        "subscription.changed": PaymentOutcome;
        /**
         * How many of one currency make one of another, or null when nobody
         * can say.
         *
         * Asked when a gateway settles in a currency the shop does not price
         * in. Null is an answer: the payment does not start and the order
         * stays unpaid, which is recoverable in a way charging the wrong
         * amount is not.
         */
        "currency.rate": number | null;
        /**
         * Whether anything installed here will need a legal identity for this
         * sale.
         *
         * False by default, and a shop with nothing issuing invoices keeps the
         * checkout it had: a tax number in front of every buyer is a longer
         * form for a field nobody reads. An invoicing module answers true, and
         * the details become required - which has to be asked before the money
         * moves, since afterwards they cannot be asked for at all.
         */
        "store.billing.required": boolean;
    }

    /** The other half of the same six filters: what each one is asked about. */
    interface BlysisFilterContexts {
        /**
         * A window of sales, for something that files them.
         *
         * An accounting integrator asks this site for what it sold between
         * two dates. It used to read the shop's `Order` table itself, which
         * meant an invoicing module knew the shop's status vocabulary and the
         * shape of its line items. The shop answers instead.
         */
        "store.orders.collect": {
            /** The shop's own word for it. Paid, unless the caller says otherwise. */
            status?: string;
            from?: Date | null;
            until?: Date | null;
            limit: number;
        };
        /**
         * An order named the way the caller was given it.
         *
         * A pulling integrator is handed a number and hands it back later,
         * possibly after an upgrade that changed which of the shop's three
         * names for an order it was holding. The shop knows all three; a
         * module that files invoices should know none of them.
         */
        "store.order.resolve": { reference: string | number };
        /**
         * A coupon somebody won.
         *
         * The wheel used to write the shop's `Coupon` table itself, which
         * meant a module about prizes knew the shop's discount vocabulary -
         * `FIXED` against `PERCENT`, `usageLimit`, `isActive`. It mints the
         * code, because the winner is told it before the row exists, and the
         * shop makes it a coupon. The caller's transaction comes with it, so
         * a prize and the coupon it promised commit together.
         */
        "coupon.issue": CouponRequest;
        /**
         * Hand somebody a thing another module owns.
         *
         * The wheel drew a prize of a kind it could not deliver - a crate key,
         * a week of VIP - wrote the spin, announced it in the public feed and
         * notified the winner, who received nothing. It has no business
         * knowing what a key is; the shop does, and the shop already has a
         * place to put one somebody did not buy.
         */
        "product.grant": ProductGrantRequest;
        /** Nothing to ask; the answer is the list. */
        "grantable.options": Record<string, never>;
        "payment.providers": { currency: string };
        "payment.session": PaymentSessionRequest;
        "payment.settled": PaymentSettlement;
        "payment.voided": { kind: PaymentKind; reference: string; provider: string };
        "payment.refunded": { provider: string; providerRef: string; amount: number | null };
        /**
         * A recurring plan started, renewed, or ended. Separate from
         * `payment.settled` because a subscription has a life of its own: the
         * store keeps the record, the gateway keeps the plan.
         */
        "subscription.changed": SubscriptionChange;
        /** ISO 4217, uppercase, both of them. */
        "currency.rate": { from: string; to: string };
        /**
         * What is being bought, so a module can require an identity only where
         * it has to - above a threshold, or in the currency it files in.
         */
        "store.billing.required": { currency: string; total: number };
    }

    /**
     * What the money is for: an order of products, a top-up of the wallet, or
     * a recurring plan.
     */
    type PaymentKind = "order" | "credits" | "subscription";

    interface PaymentProviderSummary {
        /** Matches the gateway module's own provider id, e.g. "stripe". */
        id: string;
        label: string;
        description?: string;
        /** A Lucide icon name, rendered by the checkout page. */
        icon?: string;
        /**
         * The currency this gateway settles in, when it is not the shop's.
         *
         * ISO 4217, uppercase. Left out by a gateway that takes whatever the
         * shop prices in, which is nearly all of them. The store converts and
         * refuses to start a payment it cannot convert, rather than handing a
         * processor the shop's number with a different code attached.
         */
        settlesIn?: string;
        /**
         * What this gateway costs, when the operator has chosen to pass it on.
         *
         * Declared by the gateway rather than by the store, because a gateway
         * is the only thing that knows its own rates, and left out entirely by
         * one that does not offer the choice. The store grosses the charge up
         * so that what survives the cut is what the order was worth; see
         * `grossUpForFee`.
         */
        passOnFee?: { percent: number; fixed: number };
    }

    interface PaymentSessionRequest {
        /** Which gateway is being asked. Everyone else ignores the call. */
        provider: string;
        kind: PaymentKind;
        /** The order id, or the credit purchase id. Comes back on settlement. */
        reference: string;
        /** Major units, as the buyer sees it. Gateways convert to minor units. */
        amount: number;
        /** ISO 4217, uppercase. */
        currency: string;
        description: string;
        lines: { name: string; quantity: number; unitAmount: number }[];
        successUrl: string;
        cancelUrl: string;
        customer: { userId: string | null; email: string | null; name: string | null };
        /**
         * Set only when `kind` is "subscription". A gateway that cannot take
         * recurring payments leaves the call alone, and the checkout says so
         * rather than charging once for something sold as a plan.
         */
        recurring?: {
            interval: "month" | "year";
            intervalCount: number;
            /** The store product being subscribed to. */
            productId: string;
        };
        /** Carried through the provider and handed back on settlement. */
        metadata: Record<string, string>;
    }

    interface PaymentSessionResult {
        /** False when no installed gateway answers to that provider id. */
        handled: boolean;
        /** Where to send the buyer. Null when the gateway could not start. */
        redirectUrl: string | null;
        /** The gateway's own id for the payment, stored on the order. */
        reference: string | null;
        /** A message for the buyer when the gateway refused. */
        error: string | null;
    }

    interface PaymentSettlement {
        kind: PaymentKind;
        /** The reference the session was started with. */
        reference: string;
        provider: string;
        /** The gateway's id for the money that moved. */
        providerRef: string;
        amount: number;
        currency: string;
        metadata?: Record<string, string>;
    }

    interface SubscriptionChange {
        provider: string;
        /** The gateway's id for the plan. Unique per provider. */
        providerRef: string;
        userId: string;
        productId: string;
        /** "active", "past_due", "canceled", as the provider words it. */
        status: string;
        /** When the paid-for period runs out. Null when the plan has ended. */
        currentPeriodEnd: string | null;
        /** True when the plan is over and access should be withdrawn. */
        ended: boolean;
    }

    interface PaymentOutcome {
        /** False means nobody recorded this. A webhook should fail, not ack. */
        handled: boolean;
        /** True when this arrived twice; the caller should ack, not retry. */
        duplicate: boolean;
        error: string | null;
    }
}

interface StoreOrderItemHookPayload {
    id: string;
    /** Null once the product is deleted - OrderItem.productId is optional. */
    productId: string | null;
    /** Product name as it was at purchase time, not as it is now. */
    name: string;
    quantity: number;
    /** A Prisma Decimal, like `total`. Convert before showing it. */
    price: unknown;
}

interface StoreOrderHookPayload {
    id: string;
    /**
     * When the order was placed, and who to send a document to.
     *
     * Both arrived for the invoicing modules, which were reading the order
     * back out of the shop's own table to get them - a module reaching into
     * another module's data for two fields the event could have carried.
     */
    createdAt?: Date | string;
    billingDetails?: unknown;
    buyerEmail?: string | null;
    /** Null once the buyer deletes their account - Order.userId is SetNull. */
    userId: string | null;
    orderNumber: string;
    /**
     * The integer an integrator holds and hands back.
     *
     * `id` is a cuid and `orderNumber` is a string the buyer reads. A pulling
     * integrator's schema asks for an integer and returns it once it has
     * issued the document, so the value has to lead back to this row - which
     * a hash of the cuid would not. See migrations/014.
     */
    number?: number;
    status?: string;
    total: unknown;
    /**
     * What the goods came to and what came off. The amount paid alone left an
     * invoicing module to infer a discount its schema has a field for.
     */
    subtotal?: unknown;
    discount?: unknown;
    currency?: string;
    paymentMethod?: string | null;
    metadata?: unknown;
    /**
     * What was bought. Always present: both order hooks load the order the
     * same way, through lib/order-events.ts.
     */
    items: StoreOrderItemHookPayload[];
}

export {};
