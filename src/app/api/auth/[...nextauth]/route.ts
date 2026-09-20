/**
 * Auth.js's own handler, mounted where it expects to be.
 *
 * @public-read: sign-in, sign-out, the callback and the session endpoint are
 * the door itself, so there is nobody to authenticate yet. What guards them is
 * inside: `auth.ts` runs the challenge filter before credentials are checked,
 * registers a failed password against the account's lockout counter, and rate
 * limits by address. A check here would be a second door in front of the
 * first with nothing between them.
 */
import { handlers } from "@/core/lib/auth";

export const { GET, POST } = handlers;
