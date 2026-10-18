/** Answers `store.gifts.sent`: the gifts a member sent. */
import type { HookHandlerFor } from "@/core/sdk";
import { sentGifts } from "../lib/gifts";

const answer: HookHandlerFor<"store.gifts.sent", "filter"> = async (_current, { userId }) => sentGifts(userId);

export default answer;
