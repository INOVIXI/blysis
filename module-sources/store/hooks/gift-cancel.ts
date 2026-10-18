/** Answers `store.gift.cancel`: the sender takes back a gift nobody accepted. */
import type { HookHandlerFor } from "@/core/sdk";
import { cancelGift } from "../lib/gifts";

const answer: HookHandlerFor<"store.gift.cancel", "filter"> = async (_current, { userId, itemId }) => cancelGift(userId, itemId);

export default answer;
