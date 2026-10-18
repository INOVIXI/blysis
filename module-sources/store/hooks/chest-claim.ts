/** Answers `store.chest.claim`: send a ready chest item to delivery. */
import type { HookHandlerFor } from "@/core/sdk";
import { claimChestItem } from "../lib/gifts";

const answer: HookHandlerFor<"store.chest.claim", "filter"> = async (_current, request) =>
    claimChestItem(request.userId, request.itemId, { name: request.playerName, id: request.playerId });

export default answer;
