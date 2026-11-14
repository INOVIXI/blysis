/** Answers `tickets.thread.read`: one ticket's conversation, for a support assistant. */
import type { HookHandlerFor } from "@/core/sdk";
import { readThread } from "../lib/assistant";

const threadRead: HookHandlerFor<"tickets.thread.read", "filter"> = async (_current, { ticketId }) => readThread(ticketId);

export default threadRead;
