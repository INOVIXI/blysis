/**
 * Answers `store.tax`: the rate, the name and the reason for one sale, from
 * the operator's settings and where the buyer is. The rules are `lib/rules.ts`.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { buyerOf, readTaxConfig } from "../lib/config";
import { taxFor } from "../lib/rules";

const answer: HookHandlerFor<"store.tax", "filter"> = async (storeAnswer, context) => {
    const config = await readTaxConfig();
    // Not set up yet: the store's own answer stands.
    if (!config) return storeAnswer;
    return taxFor(config, await buyerOf(config, context));
};

export default answer;
