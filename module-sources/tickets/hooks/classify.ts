/** Answers `tickets.ticket.classify`: moves a ticket to a department or priority the desk has. */
import type { HookHandlerFor } from "@/core/sdk";
import { classifyTicket } from "../lib/assistant";

const classify: HookHandlerFor<"tickets.ticket.classify", "filter"> = async (_current, request) => classifyTicket(request);

export default classify;
