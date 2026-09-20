/**
 * The setting naming which transport sends this site's mail.
 *
 * Its own file, free of imports, so a provider module's settings screen can
 * name the key without pulling `mailer.ts` - and with it the generated
 * registry of server-only handlers - into a browser bundle.
 */
export const ACTIVE_EMAIL_PROVIDER_KEY = "email_active_provider";
