/** Answers `store.catalog.ingame`: the shelves and products an admin marked for games. */
import type { HookHandlerFor } from "@/core/sdk";
import { inGameCatalog } from "../lib/ingame-catalog";

const answer: HookHandlerFor<"store.catalog.ingame", "filter"> = async () => inGameCatalog();

export default answer;
