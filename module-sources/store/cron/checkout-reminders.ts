import { doActionAsync } from "@/core/sdk";
import { log, moduleSettings, prisma } from "@/core/sdk/server";
import { sendCheckoutReminders } from "../lib/checkout-reminder";

/** Announces the checkouts left unpaid past the operator's wait, when the reminder is switched on. */
export default async function checkoutReminders(): Promise<void> {
    const settings = await moduleSettings<{ checkoutReminderEnabled: boolean; checkoutReminderHours: number }>("store");
    const announced = await sendCheckoutReminders({
        db: prisma,
        settings,
        announce: (reminder) => doActionAsync("store.checkout.reminder", reminder),
    });
    if (announced > 0) {
        log.info("cron: checkout reminders announced", { job: "store:checkout-reminders", announced });
    }
}
