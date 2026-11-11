/**
 * Answers `store.billing.required` with yes where the operator asked for every
 * buyer's address.
 *
 * A rate by country needs a country, and the billing address is the one a
 * buyer states and an invoice can name. Without it the rules fall back to the
 * connection's country, or to the default rate. Another module that wants an
 * identity keeps its yes: this only ever turns the answer on.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { readTaxConfig } from "../lib/config";

const answer: HookHandlerFor<"store.billing.required", "filter"> = async (required) => {
    if (required) return true;
    return (await readTaxConfig())?.requireBillingAddress ?? false;
};

export default answer;
