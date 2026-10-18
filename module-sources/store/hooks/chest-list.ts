/** Answers `store.chest.list`: a member's unclaimed items, pending gifts included. */
import type { HookHandlerFor } from "@/core/sdk";
import { listChest } from "../lib/gifts";

const answer: HookHandlerFor<"store.chest.list", "filter"> = async (_current, { userId }) => listChest(userId);

export default answer;
