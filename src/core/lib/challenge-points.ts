/**
 * Every form on this site that can ask whether a human is filling it in.
 *
 * Core has no CAPTCHA and must not grow one; what it has is the pair of
 * sockets a challenge module fills - a slot to draw a widget in and a filter
 * to refuse with. Until this existed the only forms either could reach were
 * core's own three, because the action was a closed union of `login`,
 * `register` and `forgotPassword`. A module that takes something written had
 * nowhere to say so, and the one form a stranger can write through without an
 * account had a rate limit and nothing else.
 *
 * A module declares its points in its manifest, the way it declares a nav
 * link, and an operator is offered the real list rather than two switches
 * somebody wrote into a screen. Core's own three are in the same list: a
 * challenge module has one question to answer - "is it switched on here?" -
 * and no reason to know which of them core owns.
 */
import { ModuleChallengePoints } from "@/core/generated/module-registry";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { getModuleStates } from "@/core/lib/module-cache";

export interface ChallengePoint {
    /** Stable, and what `runChallenge` is called with. Never shown. */
    id: string;
    /** Where the name lives, namespace and all: the words are the owner's. */
    labelKey: string;
    /** The module that declared it, or absent for one of core's own. */
    module?: string;
}

/** The forms core itself renders the slot inside. */
const CORE_POINTS: ChallengePoint[] = [
    { id: "login", labelKey: "admin.challengePoint_login" },
    { id: "register", labelKey: "admin.challengePoint_register" },
    { id: "forgotPassword", labelKey: "admin.challengePoint_forgotPassword" },
];

/**
 * Asynchronous, and server-only, because whether a module is switched off is
 * a question for the database. A point belonging to a module an operator
 * disabled is a point on a form that is not there, and offering it would let
 * them switch a challenge on for a form nobody can reach.
 */
export async function challengePoints(): Promise<ChallengePoint[]> {
    const states = await getModuleStates();
    return [
        ...CORE_POINTS,
        ...ModuleChallengePoints
            .filter((one) => isEnabledIn(states, one.module))
            .map((one) => ({ id: one.id, labelKey: one.labelKey, module: one.module })),
    ];
}
