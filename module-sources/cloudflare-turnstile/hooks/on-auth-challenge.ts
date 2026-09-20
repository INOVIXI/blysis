/**
 * Refuses anything whose Turnstile token does not check out.
 *
 * This is the half that matters. Before it existed the admin page offered
 * `enableOnLogin` and `enableOnRegister`, saved them, and nothing read them:
 * no widget was rendered anywhere and `verifyTurnstileToken` had no callers,
 * so an administrator who switched bot protection on got a page that said it
 * was on and a site that was exactly as open as before.
 *
 * Order matters here. An unconfigured module lets everything through, so
 * installing it changes nothing until keys are entered. A configured module
 * with the switch off for this particular form also lets everything through.
 * Only when both are true is a token required, and then a missing one is
 * refused as firmly as a bad one - otherwise the check is decorative.
 *
 * The form is whichever one asked. It used to be a choice between two, which
 * is all core could name; a form that declares itself as a challenge point is
 * answered for here like any other.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { getTurnstileConfig, isPointEnabled, verifyTurnstileToken } from "../lib/verify";

const FIELD = "cf-turnstile-response";

const onAuthChallenge: HookHandlerFor<"auth.challenge", "filter"> = async (result, context) => {
    // Someone else already refused; do not overwrite their reason.
    if (!result.ok) return result;

    const config = await getTurnstileConfig();
    if (!config?.siteKey || !config?.secretKey) return result;

    if (!isPointEnabled(config, context.action)) return result;

    const token = context.fields[FIELD];
    if (!token) return { ok: false, code: "captcha_missing" };

    return (await verifyTurnstileToken(token))
        ? result
        : { ok: false, code: "captcha_failed" };
};

export default onAuthChallenge;
