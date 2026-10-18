/**
 * GET /api/v1/game-connect/community-goal - the goal and how far this month has come.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * in `serverGet`.
 */
import { communityGoal } from "../../lib/bridge";
import { ok, serverGet } from "../../lib/server-route";

export const GET = serverGet(async () => {
    const goal = await communityGoal();
    if (!goal || goal.target <= 0) return ok({ active: false });
    return ok({
        active: true,
        title: goal.title,
        raised: goal.current,
        goal: goal.target,
        percent: Math.min(100, Math.floor((goal.current / goal.target) * 100)),
        endDate: goal.endDate,
    });
});
