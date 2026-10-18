/** Answers `store.purchase.credits`: a purchase paid in credits from a game. */
import type { HookHandlerFor } from "@/core/sdk";
import { purchaseWithCredits } from "../lib/credit-purchase";

const answer: HookHandlerFor<"store.purchase.credits", "filter"> = async (_current, request) => purchaseWithCredits(request);

export default answer;
