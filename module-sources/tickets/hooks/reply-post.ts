/** Answers `tickets.reply.post`: adds a support assistant's message, where it may speak. */
import type { HookHandlerFor } from "@/core/sdk";
import { postAssistantReply } from "../lib/assistant";

const replyPost: HookHandlerFor<"tickets.reply.post", "filter"> = async (_current, request) => postAssistantReply(request);

export default replyPost;
