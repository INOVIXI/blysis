import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/core/lib/api-body";
import { prisma } from "@/core/lib/db";
import { PASSWORD_RESET_EXPIRY, getDurationMs } from "@/core/lib/security-settings";
import { randomBytes, createHash } from "crypto";
import { sendPasswordResetEmail } from "@/core/lib/email";
import { rateLimit, getClientIP } from "@/core/lib/rate-limit";
import { runChallenge } from "@/core/lib/auth-challenge";
import { resolveAppUrl } from "@/core/lib/app-url";
import { challengeFieldsFrom } from "@/core/lib/auth-challenge-shared";
import { log } from "@/core/lib/logger";

const GENERIC_OK = { message: "If an account exists, a reset link has been sent." };

/** The one field this endpoint reads. The challenge payload rides alongside it
 * and is read by `challengeFieldsFrom`, which owns that shape. */
const forgotPasswordSchema = z.object({
    email: z.string().max(254).optional(),
});

// POST /api/v1/auth/forgot-password
export async function POST(request: NextRequest) {
    try {
        const ip = getClientIP(request.headers);
        // Per-IP cap blocks bulk enumeration from a single attacker IP.
        const rlIp = await rateLimit(`forgot:ip:${ip}`, { maxRequests: 10, windowMs: 3600000 });
        if (!rlIp.success) {
            return NextResponse.json({ error: "Too many attempts. Try again later.", code: "rate_limited" }, { status: 429 });
        }

        const raw = await readJsonBody(request, { fallback: {} });
        if (raw instanceof NextResponse) return raw;
        // A body that does not fit is treated as an empty one rather than
        // refused: this endpoint answers the same generic success either way,
        // and a shape-specific error would be the signal it exists to withhold.
        const parsed = forgotPasswordSchema.safeParse(raw);
        const email = parsed.success ? (parsed.data.email ?? "").trim().toLowerCase() : "";

        // A reset mail is free to send and lands in someone else's inbox, so
        // a challenge module gets a say here too. The refusal keeps the same
        // generic shape as every other branch: this endpoint never confirms
        // whether an address exists.
        const challenge = await runChallenge({
            action: "forgotPassword",
            fields: challengeFieldsFrom(raw),
            ip,
        });
        if (!challenge.ok) {
            return NextResponse.json(
                { error: "Verification failed", code: challenge.code ?? "challenge_failed" },
                { status: 400 },
            );
        }

        if (!email || email.length > 254 || !email.includes("@")) {
            // Still return the generic success message so we don't leak
            // "email format invalid" as a signal an attacker can branch on.
            return NextResponse.json(GENERIC_OK);
        }

        // Per-email cap stops an attacker from sending 10 emails to a
        // victim's inbox via per-IP buckets bouncing across proxies.
        const rlEmail = await rateLimit(`forgot:email:${email}`, { maxRequests: 3, windowMs: 3600000 });
        if (!rlEmail.success) {
            return NextResponse.json(GENERIC_OK);
        }

        const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isBanned: true, isDeleted: true, locale: true } });

        // Build the token unconditionally so the response time is (roughly)
        // constant whether or not the email belongs to a real account.
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");

        if (user && !user.isBanned && !user.isDeleted) {
            // Single active reset token per user.
            await prisma.verificationToken.deleteMany({ where: { identifier: email } });

            const expires = new Date(Date.now() + (await getDurationMs(PASSWORD_RESET_EXPIRY)));
            await prisma.verificationToken.create({
                data: {
                    identifier: email,
                    // Store only the SHA-256 digest. A DB dump now reveals
                    // hashes, not usable reset tokens. The plaintext token
                    // is only ever in the outbound email.
                    token: tokenHash,
                    expires,
                },
            });

            // See verify-email: one resolver, validated, same fallback as
            // the rest of the app.
            const resetUrl = `${resolveAppUrl()}/auth/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

            await sendPasswordResetEmail(email, resetUrl, user.locale ?? undefined).catch((err) => {
                log.error("[forgot-password] email send failed", { error: err instanceof Error ? err.message : String(err) });
            });
        }

        return NextResponse.json(GENERIC_OK);
    } catch (error) {
        log.error("Forgot password error", { error: error instanceof Error ? error.message : String(error) });
        // Return generic message on errors too so internal failures can't
        // be distinguished from "email not registered" by a timing probe.
        return NextResponse.json(GENERIC_OK);
    }
}
