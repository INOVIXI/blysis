import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { prisma } from "@/core/lib/db";
import { registerSchema } from "@/core/lib/validations";
import { sendWelcomeEmail } from "@/core/lib/email";
import { logActivity } from "@/core/lib/activity-log";
import { rateLimit, getClientIP, rateLimits } from "@/core/lib/rate-limit";
import { hashPassword } from "@/core/lib/password-hash";
import { checkUsername, registrationRefusal } from "@/core/lib/registration-rules";
import { checkPasswordBreach } from "@/core/lib/password-breach";
import {
    enforcePasswordPolicy,
    getHashAlgorithm,
    getRegistrationCaps,
    getUsernameRule,
} from "@/core/lib/security-settings";
import { runChallenge } from "@/core/lib/auth-challenge";
import { challengeFieldsFrom } from "@/core/lib/auth-challenge-shared";
import { readJsonBody } from "@/core/lib/api-body";
import { log } from "@/core/lib/logger";

// Derive a locale code ("en"/"tr") from the request URL. Falls back to "en".
// Used at signup so the welcome email goes out in the language the visitor
// was actually browsing in (instead of always English).
function detectLocale(request: NextRequest): string {
    const referer = request.headers.get("referer") || request.headers.get("origin") || "";
    const path = (() => {
        try { return new URL(referer).pathname; } catch { return ""; }
    })();
    const seg = path.split("/").filter(Boolean)[0];
    if (seg === "tr" || seg === "en") return seg;
    return "en";
}

export async function POST(request: NextRequest) {
    await ensureHooks();
    // Rate limit: 10 requests per minute per IP
    const ip = getClientIP(request.headers);
    const rl = await rateLimit(`register:${ip}`, rateLimits.auth);
    if (!rl.success) return NextResponse.json({ error: "Too many attempts. Try again later.", code: "rate_limited" }, { status: 429 });
    try {
        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;

        const validation = registerSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message, code: "invalid_input" },
                { status: 400 }
            );
        }

        const { email, username, password } = validation.data;

        // Whatever module owns the auth.form.challenge slot gets to refuse
        // here, before an account exists. With none installed the filter has
        // no listeners and this returns the value it was handed.
        const challenge = await runChallenge({
            action: "register",
            fields: challengeFieldsFrom(body),
            ip,
        });
        if (!challenge.ok) {
            return NextResponse.json(
                { error: "Verification failed", code: challenge.code ?? "challenge_failed" },
                { status: 400 },
            );
        }

        // The zod schema enforces the built-in policy; this adds the admin's
        // configured minimum length, which can only be stricter.
        const policyCheck = await enforcePasswordPolicy(password);
        if (!policyCheck.ok) {
            return NextResponse.json({ error: policyCheck.message ?? "Invalid password", code: "weak_password" }, { status: 400 });
        }

        // Optional HIBP breach check (opt-in via PASSWORD_BREACH_CHECK=1).
        // Uses k-anonymity so only the first 5 chars of the SHA-1 digest
        // ever leave the server. A flaky HIBP fails open.
        const breach = await checkPasswordBreach(password);
        if (!breach.ok) {
            return NextResponse.json(
                { error: "This password has appeared in a known data breach - pick something else.", code: "password_breached" },
                { status: 400 },
            );
        }

        // The operator's own rule, on top of the schema's. It can only be
        // narrower than what `registerSchema` already accepted, so anything
        // reaching here has passed both.
        const naming = await getUsernameRule();
        const named = checkUsername(username, naming.rule, naming.minLength);
        // Two literal codes rather than one built from the reason: a code a
        // client cannot predict is a code no screen can put into a sentence.
        if (!named.ok && named.reason === "too_short") {
            return NextResponse.json(
                { error: "That username is too short", code: "username_too_short" },
                { status: 400 },
            );
        }
        if (!named.ok) {
            return NextResponse.json(
                { error: "That username is not allowed here", code: "username_not_allowed" },
                { status: 400 },
            );
        }

        // Counted before the account is written and after the password checks,
        // so a site at its ceiling still refuses a weak password on its own
        // terms rather than blaming the cap.
        const caps = await getRegistrationCaps();
        if (caps.daily > 0 || caps.total > 0) {
            const dayStart = new Date();
            dayStart.setHours(0, 0, 0, 0);
            const [today, total] = await Promise.all([
                caps.daily > 0 ? prisma.user.count({ where: { createdAt: { gte: dayStart } } }) : Promise.resolve(0),
                caps.total > 0 ? prisma.user.count() : Promise.resolve(0),
            ]);
            const refused = registrationRefusal(caps, { today, total });
            if (refused === "daily_cap") {
                return NextResponse.json(
                    { error: "No more accounts today", code: "registration_daily_cap" },
                    { status: 403 },
                );
            }
            if (refused === "total_cap") {
                return NextResponse.json(
                    { error: "Registration is closed", code: "registration_total_cap" },
                    { status: 403 },
                );
            }
        }

        // Fast-path rejection for the common (non-concurrent) duplicate case
        // so we don't burn bcrypt cycles on a doomed insert. Concurrent
        // duplicates still race through the unique-constraint catch below.
        const existingUser = await prisma.user.findFirst({
            where: { OR: [{ email }, { username }] },
            select: { id: true },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: "Email or username already registered", code: "already_registered" },
                { status: 400 }
            );
        }

        // Default role lookup - upsert so two concurrent first-time registrations
        // can't both try to INSERT role "member" and one fail with P2002 on
        // name unique (which would have been reported back as "email taken").
        const defaultRole = await prisma.role.upsert({
            where: { name: "member" },
            update: {},
            create: {
                name: "member",
                displayName: "Member",
                isDefault: true,
                priority: 0,
            },
        });

        const hashedPassword = await hashPassword(password, await getHashAlgorithm());
        const userLocale = detectLocale(request);

        const user = await prisma.user.create({
            data: {
                email,
                username,
                password: hashedPassword,
                roleId: defaultRole.id,
                locale: userLocale,
            },
            select: {
                id: true,
                email: true,
                username: true,
                createdAt: true,
            },
        });

        // Non-blocking side effects. Anything module-specific reacts to the
        // `user.registered` hook fired below rather than being called here.
        sendWelcomeEmail(email, username, userLocale).catch((err: unknown) => log.error("[register] sending the welcome email failed", { error: err instanceof Error ? err.message : String(err) }));
        logActivity({ userId: user.id, action: "user.register", entity: "user", entityId: user.id }).catch((err: unknown) => log.error("[register] recording the sign up in the activity log failed", { error: err instanceof Error ? err.message : String(err) }));

        // Fire user.registered hook action - modules can react (welcome coupons, etc.)
        import("@/core/lib/hooks")
            .then(({ doActionAsync }) =>
                doActionAsync("user.registered", {
                    userId: user.id,
                    email: user.email,
                    username: user.username,
                })
            )
            .catch(() => {});

        return NextResponse.json(
            { message: "User created successfully", user },
            { status: 201 }
        );
    } catch (error: unknown) {
        log.error("Registration error", { error: error instanceof Error ? error.message : String(error) });

        // Handle Prisma unique constraint violations (P2002)
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code: string }).code === "P2002"
        ) {
            return NextResponse.json(
                { error: "Email or username already registered", code: "already_registered" },
                { status: 400 }
            );
        }

        // Handle Prisma connection / adapter errors
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            typeof (error as { code: string }).code === "string" &&
            (error as { code: string }).code.startsWith("P")
        ) {
            log.error("Prisma error code", { error: String((error as { code: string }).code) });
            return NextResponse.json(
                { error: "Database error. Please try again later.", code: "db_error" },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { error: "Internal server error", code: "server_error" },
            { status: 500 }
        );
    }
}
