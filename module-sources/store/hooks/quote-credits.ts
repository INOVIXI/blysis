/** Answers `store.quote.credits`: what a purchase in game would take, before the player confirms it. */
import type { HookHandlerFor } from "@/core/sdk";
import { quoteWithCredits } from "../lib/credit-purchase";

const answer: HookHandlerFor<"store.quote.credits", "filter"> = async (_current, request) => quoteWithCredits(request);

export default answer;
