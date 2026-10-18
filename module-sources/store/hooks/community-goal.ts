/** Answers `store.community-goal`: the goal and what this month has raised toward it. */
import type { HookHandlerFor } from "@/core/sdk";
import { readCommunityGoal } from "../lib/community-goal";

const answer: HookHandlerFor<"store.community-goal", "filter"> = async () => readCommunityGoal();

export default answer;
