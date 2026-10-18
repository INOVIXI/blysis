/** Answers `store.gift.activate`: the recipient accepts a pending gift. */
import type { HookHandlerFor } from "@/core/sdk";
import { activateGift } from "../lib/gifts";

const answer: HookHandlerFor<"store.gift.activate", "filter"> = async (_current, { userId, itemId }) => activateGift(userId, itemId);

export default answer;
