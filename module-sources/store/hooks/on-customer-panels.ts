/**
 * What the shop knows about one member, for the screen an operator opens when
 * somebody writes in.
 *
 * Counts and totals rather than rows: the panel sits beside four others and an
 * operator scanning it wants to know whether this is a customer who has spent
 * three hundred or one who has never bought anything. The link is how they get
 * to the detail.
 *
 * The words are translated here rather than sent as keys. This module knows
 * which catalogue they are in and the screen does not, and an `adm_` key sent
 * to a page is a key that page never receives - core strips them from what a
 * public catalogue carries.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { formatSiteCurrency, moduleTranslator, prisma, siteCurrency } from "@/core/sdk/server";
import { totalsIn } from "../lib/money-totals";

const onCustomerPanels: HookHandlerFor<"admin.customer.panels", "filter"> = async (panels, context) => {
    const [orders, paid, balance] = await Promise.all([
        prisma.order.count({ where: { userId: context.userId } }),
        prisma.order.groupBy({
            by: ["currency"],
            where: { userId: context.userId, status: "COMPLETED" },
            _sum: { total: true },
        }),
        prisma.user.findUnique({
            where: { id: context.userId },
            select: { creditBalance: true },
        }),
    ]);

    // Nothing to say about somebody who has never been near the shop, and a
    // panel of zeroes is a panel an operator has to read to learn nothing.
    if (orders === 0 && Number(balance?.creditBalance ?? 0) === 0) return panels;

    /*
     * This module's own catalogue, read on the server. next-intl's own
     * `getTranslations` finds a locale in the route segment and an API route
     * has none, so asked from one it answers with the key path - measured, as
     * `store.adm_customerPanel` on an operator's screen.
     */
    const t = await moduleTranslator("store", context.locale);

    // Each currency the member paid in, converted before it is added. See
    // `lib/money-totals.ts`.
    const base = await siteCurrency();
    const spent = await totalsIn(base, paid.map((row) => ({ key: "spent", currency: row.currency, amount: Number(row._sum.total ?? 0) })));

    return [
        ...panels,
        {
            key: "store",
            label: t("adm_customerPanel"),
            rows: [
                { label: t("adm_customerOrders"), value: String(orders) },
                { label: t("adm_customerSpent"), value: await formatSiteCurrency(spent.get("spent") ?? 0, context.locale) },
                { label: t("adm_customerCredits"), value: Number(balance?.creditBalance ?? 0).toFixed(2) },
            ],
            href: "/admin/store/orders",
        },
    ];
};

export default onCustomerPanels;
