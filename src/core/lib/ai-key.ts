/**
 * The setting that names which AI provider a site uses, when more than one is
 * installed.
 *
 * Its own file, free of imports, so a provider module's settings screen can
 * name the key without pulling lib/ai.ts - and with it the generated registry
 * of server-only handlers - into a browser bundle. The same reason
 * lib/mailer-key.ts exists.
 */
export const ACTIVE_AI_PROVIDER_KEY = "ai_active_provider";
