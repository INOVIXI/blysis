/**
 * The store's own delivery of a checkout reminder: one email.
 *
 * The sweep in lib/checkout-reminder.ts decides that a checkout is due and
 * makes sure it is only ever announced once; this decides whether the buyer
 * wants it. The switch is theirs, in their notification settings, and the
 * email links back to it.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma, shouldNotify } from "@/core/sdk/server";
import { queueCheckoutReminder } from "../lib/checkout-reminder-email";

const onCheckoutReminder: HookHandlerFor<"store.checkout.reminder", "action"> = async (reminder) => {
    if (!(await shouldNotify(reminder.userId, "store.checkout.reminder", "email"))) return;

    const buyer = await prisma.user.findUnique({
        where: { id: reminder.userId },
        select: { email: true, locale: true },
    });
    if (!buyer?.email) return;

    await queueCheckoutReminder({
        to: buyer.email,
        locale: buyer.locale,
        kind: reminder.kind,
        orderNumber: reminder.orderNumber,
        total: reminder.total,
        resumePath: reminder.resumePath,
    });
};

export default onCheckoutReminder;
