/**
 * Which module sends this site's mail.
 *
 * Core used to import `resend` and call `new Resend(apiKey)`. That named a
 * vendor in core, and it meant there was exactly one way to send mail on this
 * platform: an operator with an SMTP relay had nowhere to put it. Half the
 * contract was already right - a manifest's `emailProvider` tells core which
 * settings key holds the credential, because reading that key by its literal
 * name was core naming a module - and the sending was the half still left.
 *
 * A mail provider is a module now, the same shape as a storage provider: the
 * manifest names a handler, the generator collects them, core resolves the one
 * the operator chose and calls it.
 *
 * ## Why not the hook bus
 *
 * Every listener there is raced against `DEFAULT_HOOK_TIMEOUT_MS`. An SMTP
 * send that times out at the bus while still arriving at the relay is a
 * message core believes failed - and the queue retries a failure, so the
 * recipient gets it twice. A direct call has no deadline to invent.
 *
 * ## Choosing
 *
 * One installed provider needs no setting: that is every install that exists
 * today and asking them to choose between one thing would be a migration for
 * nothing. Two or more and the operator names one, because picking for them
 * would mean mail leaving through a relay they did not choose.
 */
import { EmailProviderRegistry } from "@/core/generated/module-email";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { readSettingValues } from "@/core/lib/setting-values";
import { errorText, log } from "@/core/lib/logger";

export { ACTIVE_EMAIL_PROVIDER_KEY } from "@/core/lib/mailer-key";
import { ACTIVE_EMAIL_PROVIDER_KEY } from "@/core/lib/mailer-key";

/**
 * A message as the provider receives it: already sanitised, already addressed.
 * `from` carries the display name, in the one form every transport takes.
 */
export interface EmailMessage {
    from: string;
    to: string;
    subject: string;
    html: string;
}

export interface EmailProvider {
    /** Whether this provider has what it needs. A key, a host, a password. */
    isConfigured(): Promise<boolean>;
    /** Throws on failure: the queue reads a rejection as "try again". */
    send(message: EmailMessage): Promise<void>;
}

/**
 * The transports that could send, which is not the same as the ones present.
 *
 * A provider belonging to a module an operator switched off is a transport
 * they took away; sending through it anyway would make the switch a lie, and
 * on a site with two installed it would send through the wrong one.
 */
async function installedIds(): Promise<string[]> {
    const registered = Object.keys(EmailProviderRegistry).sort();
    if (registered.length === 0) return registered;
    try {
        const states = await getModuleStates();
        return registered.filter((id) => isEnabledIn(states, id));
    } catch (err) {
        // An unreadable config is a database problem, not a configuration
        // one, and `isEnabledIn` reads absent as enabled for the same reason:
        // a blip must not stop the mail.
        log.warn("[mail] module states could not be read", { error: errorText(err) });
        return registered;
    }
}

async function chosenId(): Promise<string | null> {
    try {
        const values = await readSettingValues([ACTIVE_EMAIL_PROVIDER_KEY]);
        const raw = values[ACTIVE_EMAIL_PROVIDER_KEY];
        return typeof raw === "string" && raw.trim() ? raw.trim() : null;
    } catch (err) {
        // A settings read must never be the reason mail stops.
        log.warn("[mail] the chosen provider could not be read", { error: errorText(err) });
        return null;
    }
}

/**
 * The provider this site sends through, or null when there is none to use.
 *
 * Null covers four cases and they are deliberately one answer: nothing is
 * installed, the one thing installed has no credential, two are installed and
 * nobody chose, or the chosen one is gone or unconfigured. In every one of
 * them there is no transport, which is the state `email.ts` already knew how
 * to report.
 */
export async function activeProviderId(): Promise<string | null> {
    const ids = await installedIds();
    if (ids.length === 0) return null;
    if (ids.length === 1) return ids[0];
    const chosen = await chosenId();
    return chosen && ids.includes(chosen) ? chosen : null;
}

export async function resolveMailer(): Promise<EmailProvider | null> {
    const id = await activeProviderId();
    if (!id) return null;

    const loader = EmailProviderRegistry[id];
    if (!loader) return null;

    try {
        const provider = (await loader()) as EmailProvider | null;
        if (!provider || typeof provider.send !== "function") {
            log.warn("[mail] the provider loaded as nothing", { provider: id });
            return null;
        }
        // An unconfigured provider is not a transport. Saying so here rather
        // than at the send keeps "no transport configured" one answer.
        if (typeof provider.isConfigured === "function" && !(await provider.isConfigured())) {
            return null;
        }
        return provider;
    } catch (err) {
        log.error("[mail] the provider could not be loaded", { provider: id, error: errorText(err) });
        return null;
    }
}
