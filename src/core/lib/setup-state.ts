import prisma from "@/core/lib/db";

/**
 * Setup state tracking.
 *
 * A fresh install has zero users. When the first admin is created via the
 * setup wizard, we flip `setupComplete` to `true` permanently (for the life
 * of this process). Middleware and API routes check this to decide whether
 * to gate incoming requests behind the wizard.
 *
 * On DB errors we fail-safe (return true) so that a broken database never
 * locks an installed site into an un-escapable setup screen.
 */

let setupComplete = false;
let lastCheck = 0;
const CHECK_INTERVAL_MS = 10_000;
/**
 * The answer of the last check, given again inside the throttle window. It
 * used to be a hard-coded false: after a restart, every request that arrived
 * while the first count was still running, and every request after a failed
 * count, was told the site was not installed and sent to the wizard.
 */
let lastAnswer = false;
/** The count in flight, so requests that arrive meanwhile wait for it. */
let pending: Promise<boolean> | null = null;

export async function isSetupComplete(): Promise<boolean> {
    if (setupComplete) return true;
    if (pending) return pending;

    const now = Date.now();
    if (now - lastCheck < CHECK_INTERVAL_MS) return lastAnswer;
    lastCheck = now;

    pending = countUsers().finally(() => {
        pending = null;
    });
    return pending;
}

async function countUsers(): Promise<boolean> {
    try {
        const count = await prisma.user.count();
        if (count > 0) setupComplete = true;
        lastAnswer = count > 0;
    } catch {
        // Fail-safe: if the database is unreachable, don't trap visitors in
        // the setup wizard. Treat as complete, without latching, so a fresh
        // install is still noticed once the database answers.
        lastAnswer = true;
    }
    return lastAnswer;
}

export function markSetupComplete(): void {
    setupComplete = true;
    lastCheck = Date.now();
}

/**
 * Test / internal helper: force a re-check on next call.
 * Not called from normal app flow.
 */
export function resetSetupStateForTesting(): void {
    setupComplete = false;
    lastCheck = 0;
    lastAnswer = false;
    pending = null;
}
