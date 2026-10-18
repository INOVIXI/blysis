/** Answers `store.gifts.receive`: whether a member takes gifts, changing it when asked. */
import type { HookHandlerFor } from "@/core/sdk";
import { setReceivesGifts } from "../lib/gifts";

const answer: HookHandlerFor<"store.gifts.receive", "filter"> = async (_current, { userId, receive }) =>
    setReceivesGifts(userId, receive);

export default answer;
