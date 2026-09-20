import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * email.ts was at 0% coverage while carrying the SMTP header-injection
 * defence for every outbound message in the product. `to` and `subject`
 * reach it from user-controlled places (registration, password reset,
 * broadcasts), so a bare CR/LF slipping through turns any of them into an
 * arbitrary-recipient Bcc. The queue's retry/backoff arithmetic is the
 * other untested half: getting MAX_ATTEMPTS wrong either drops mail
 * silently or hammers the provider forever.
 */

// --- prisma ----------------------------------------------------------------

const emailJob = {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
};

vi.mock("@/core/lib/db", () => ({ prisma: { emailJob } }));

// --- logger ----------------------------------------------------------------

const logWarn = vi.fn();

vi.mock("@/core/lib/logger", () => ({
    
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),log: { debug: vi.fn(), info: vi.fn(), warn: logWarn, error: vi.fn() },
}));

// --- the transport ---------------------------------------------------------
//
// Core used to construct a vendor's client here, so this mocked the vendor.
// It resolves whatever transport is installed now, so this mocks that: the
// seam moved, the assertions about what is sent did not.

const providerSend = vi.fn(async (_opts: Record<string, unknown>) => ({ id: "re_1" }));
let transportInstalled = true;

vi.mock("@/core/lib/mailer", () => ({
    resolveMailer: async () => (transportInstalled ? { send: providerSend } : null),
}));

// ---------------------------------------------------------------------------

type EmailModule = typeof import("@/core/lib/email");

/**
 * FROM_EMAIL and APP_NAME are captured at module scope, so anything that
 * asserts on the From header has to set the env *before* the import.
 */
async function load(env: Record<string, string> = {}): Promise<EmailModule> {
    vi.resetModules();
    transportInstalled = true;
    vi.stubEnv("SITE_NAME", "");
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", "");
    vi.stubEnv("EMAIL_FROM", "");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return (await import("@/core/lib/email")) as EmailModule;
}

/** Load with a working transport so deliverViaProvider actually calls out. */
function loadWithProvider(env: Record<string, string> = {}): Promise<EmailModule> {
    return load(env);
}

/** Load with nothing installed, which is what suppresses a send. */
async function loadWithoutProvider(env: Record<string, string> = {}): Promise<EmailModule> {
    const mod = await load(env);
    transportInstalled = false;
    return mod;
}

interface JobRow {
    id: string;
    to: string;
    subject: string;
    body: string;
    html: string | null;
    attempts: number;
}

function job(over: Partial<JobRow> = {}): JobRow {
    return {
        id: "job-1",
        to: "user@example.com",
        subject: "Hello",
        body: "plain body",
        html: null,
        attempts: 0,
        ...over,
    };
}

/** The single options object handed to the provider. */
function lastSend(): Record<string, unknown> {
    const call = providerSend.mock.calls.at(-1);
    if (!call) throw new Error("provider was never called");
    return call[0];
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    emailJob.create.mockReset().mockResolvedValue({ id: "job-1" });
    emailJob.findMany.mockReset().mockResolvedValue([]);
    emailJob.updateMany.mockReset().mockResolvedValue({ count: 0 });
    emailJob.update.mockReset().mockResolvedValue({});
    providerSend.mockReset().mockResolvedValue({ id: "re_1" });
    logWarn.mockReset();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    consoleError.mockRestore();
    vi.unstubAllEnvs();
});

// ===========================================================================
// queueEmail
// ===========================================================================

describe("queueEmail", () => {
    it("writes a pending job and returns its id", async () => {
        const { queueEmail } = await load();
        emailJob.create.mockResolvedValue({ id: "job-42" });

        const id = await queueEmail({ to: "a@b.co", subject: "Hi", body: "text" });

        expect(id).toBe("job-42");
        const data = emailJob.create.mock.calls[0]![0].data;
        expect(data.to).toBe("a@b.co");
        expect(data.subject).toBe("Hi");
        expect(data.body).toBe("text");
        expect(data.status).toBe("pending");
    });

    it("stores null rather than undefined when no html is given", async () => {
        const { queueEmail } = await load();
        await queueEmail({ to: "a@b.co", subject: "Hi", body: "text" });
        expect(emailJob.create.mock.calls[0]![0].data.html).toBeNull();
    });

    it("keeps the html body when one is given", async () => {
        const { queueEmail } = await load();
        await queueEmail({ to: "a@b.co", subject: "Hi", body: "text", html: "<b>x</b>" });
        expect(emailJob.create.mock.calls[0]![0].data.html).toBe("<b>x</b>");
    });

    it("defaults scheduledAt to now", async () => {
        const { queueEmail } = await load();
        const before = Date.now();
        await queueEmail({ to: "a@b.co", subject: "Hi", body: "text" });
        const at = emailJob.create.mock.calls[0]![0].data.scheduledAt as Date;
        expect(at.getTime()).toBeGreaterThanOrEqual(before);
        expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("honours an explicit scheduleFor", async () => {
        const { queueEmail } = await load();
        const when = new Date("2030-01-01T00:00:00.000Z");
        await queueEmail({ to: "a@b.co", subject: "Hi", body: "text", scheduleFor: when });
        expect(emailJob.create.mock.calls[0]![0].data.scheduledAt).toBe(when);
    });

    it("returns null instead of throwing when the insert fails", async () => {
        const { queueEmail } = await load();
        emailJob.create.mockRejectedValue(new Error("db down"));

        await expect(queueEmail({ to: "a@b.co", subject: "Hi", body: "x" })).resolves.toBeNull();
        expect(consoleError).toHaveBeenCalled();
    });
});

// ===========================================================================
// processEmailQueue - claiming
// ===========================================================================

describe("processEmailQueue claiming", () => {
    it("claims nothing when the queue is empty", async () => {
        const { processEmailQueue } = await load();

        await expect(processEmailQueue()).resolves.toEqual({
            processed: 0, sent: 0, failed: 0, retried: 0,
        });
        // One write still goes out: the sweep that takes back a claim a dead
        // process was holding runs before the queue is read, because a
        // stranded row is exactly what an empty-looking queue can be hiding.
        const claims = emailJob.updateMany.mock.calls.filter(
            ([a]) => (a as { data: { status?: string } }).data.status === "sending",
        );
        expect(claims).toEqual([]);
    });

    it("selects only due pending jobs, oldest first", async () => {
        const { processEmailQueue } = await load();
        await processEmailQueue();

        const args = emailJob.findMany.mock.calls[0]![0];
        expect(args.where.status).toBe("pending");
        expect(args.where.scheduledAt.lte).toBeInstanceOf(Date);
        expect(args.orderBy).toEqual({ scheduledAt: "asc" });
    });

    it("defaults the batch size to 10 and honours an override", async () => {
        const { processEmailQueue } = await load();
        await processEmailQueue();
        expect(emailJob.findMany.mock.calls[0]![0].take).toBe(10);

        await processEmailQueue(3);
        expect(emailJob.findMany.mock.calls[1]![0].take).toBe(3);
    });

    it("claims the batch by flipping pending rows to sending", async () => {
        const { processEmailQueue } = await load();
        emailJob.findMany.mockResolvedValue([job({ id: "a" }), job({ id: "b" })]);
        emailJob.updateMany.mockResolvedValue({ count: 2 });

        await processEmailQueue();

        // The first call is the stale-claim sweep; the claim is the one that
        // names the rows it just read.
        const args = emailJob.updateMany.mock.calls.find(
            ([a]) => (a as { data: { status?: string } }).data.status === "sending",
        )![0];
        expect(args.where.id.in).toEqual(["a", "b"]);
        // The status guard is what stops a second worker re-claiming the row.
        expect(args.where.status).toBe("pending");
        expect(args.data.status).toBe("sending");
        // Stamped, so the sweep above can tell a live claim from a dead one.
        expect(args.data.scheduledAt).toBeInstanceOf(Date);
    });

    it("sends nothing when another worker won the claim", async () => {
        const { processEmailQueue } = await loadWithProvider();
        emailJob.findMany.mockResolvedValue([job()]);
        emailJob.updateMany.mockResolvedValue({ count: 0 });

        await expect(processEmailQueue()).resolves.toEqual({
            processed: 0, sent: 0, failed: 0, retried: 0,
        });
        expect(providerSend).not.toHaveBeenCalled();
        expect(emailJob.update).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// processEmailQueue - delivery outcomes
// ===========================================================================

describe("processEmailQueue delivery", () => {
    beforeEach(() => {
        emailJob.updateMany.mockResolvedValue({ count: 1 });
    });

    it("marks a delivered job sent and clears the previous error", async () => {
        const { processEmailQueue } = await load();
        emailJob.findMany.mockResolvedValue([job()]);

        const result = await processEmailQueue();

        expect(result).toEqual({ processed: 1, sent: 1, failed: 0, retried: 0 });
        const data = emailJob.update.mock.calls[0]![0].data;
        expect(data.status).toBe("sent");
        expect(data.attempts).toBe(1);
        expect(data.sentAt).toBeInstanceOf(Date);
        expect(data.lastError).toBeNull();
    });

    it("wraps a plain-text body in an escaped <pre> block", async () => {
        const { processEmailQueue } = await loadWithProvider();
        emailJob.findMany.mockResolvedValue([job({ body: "<script>alert(1)</script>" })]);

        await processEmailQueue();

        expect(lastSend().html).toBe("<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>");
    });

    it("uses the stored html verbatim when the job has one", async () => {
        const { processEmailQueue } = await loadWithProvider();
        emailJob.findMany.mockResolvedValue([job({ html: "<b>rich</b>" })]);

        await processEmailQueue();

        expect(lastSend().html).toBe("<b>rich</b>");
    });

    it("reschedules the first failure two minutes out", async () => {
        const { processEmailQueue } = await load();
        emailJob.findMany.mockResolvedValue([job({ to: "not-an-address" })]);
        const now = Date.now();

        const result = await processEmailQueue();

        expect(result).toEqual({ processed: 1, sent: 0, failed: 0, retried: 1 });
        const data = emailJob.update.mock.calls[0]![0].data;
        expect(data.status).toBe("pending");
        expect(data.attempts).toBe(1);
        expect(data.lastError).toBe("Invalid recipient address");
        const delay = (data.scheduledAt as Date).getTime() - now;
        expect(delay).toBeGreaterThanOrEqual(2 * 60_000 - 1_000);
        expect(delay).toBeLessThanOrEqual(2 * 60_000 + 5_000);
    });

    it("doubles the backoff on the second failure", async () => {
        const { processEmailQueue } = await load();
        emailJob.findMany.mockResolvedValue([job({ to: "nope", attempts: 1 })]);
        const now = Date.now();

        await processEmailQueue();

        const data = emailJob.update.mock.calls[0]![0].data;
        expect(data.attempts).toBe(2);
        const delay = (data.scheduledAt as Date).getTime() - now;
        expect(delay).toBeGreaterThanOrEqual(4 * 60_000 - 1_000);
        expect(delay).toBeLessThanOrEqual(4 * 60_000 + 5_000);
    });

    it("gives up at the third attempt instead of rescheduling forever", async () => {
        const { processEmailQueue } = await load();
        emailJob.findMany.mockResolvedValue([job({ to: "nope", attempts: 2 })]);

        const result = await processEmailQueue();

        expect(result).toEqual({ processed: 1, sent: 0, failed: 1, retried: 0 });
        const data = emailJob.update.mock.calls[0]![0].data;
        expect(data.status).toBe("failed");
        expect(data.attempts).toBe(3);
        expect(data.scheduledAt).toBeUndefined();
    });

    it("tallies a mixed batch independently", async () => {
        const { processEmailQueue } = await load();
        emailJob.findMany.mockResolvedValue([
            job({ id: "ok" }),
            job({ id: "retry", to: "bad" }),
            job({ id: "dead", to: "bad", attempts: 2 }),
        ]);
        emailJob.updateMany.mockResolvedValue({ count: 3 });

        await expect(processEmailQueue()).resolves.toEqual({
            processed: 3, sent: 1, failed: 1, retried: 1,
        });
    });

    it("records the provider's own error message on the row", async () => {
        const { processEmailQueue } = await loadWithProvider();
        emailJob.findMany.mockResolvedValue([job()]);
        providerSend.mockRejectedValue(new Error("rate limited"));

        await processEmailQueue();

        expect(emailJob.update.mock.calls[0]![0].data.lastError).toBe("rate limited");
    });

    it("stringifies a non-Error rejection from the provider", async () => {
        const { processEmailQueue } = await loadWithProvider();
        emailJob.findMany.mockResolvedValue([job()]);
        providerSend.mockRejectedValue("boom");

        await processEmailQueue();

        expect(emailJob.update.mock.calls[0]![0].data.lastError).toBe("boom");
    });
});

// ===========================================================================
// Header injection - the reason this file exists
// ===========================================================================

describe("recipient validation", () => {
    const rejected = [
        ["a CRLF sequence", "victim@example.com\r\nBcc: attacker@evil.com"],
        ["a bare newline", "victim@example.com\nBcc: attacker@evil.com"],
        ["a NUL byte", "victim@example.com\0"],
        ["a comma-separated second recipient", "victim@example.com,attacker@evil.com"],
        ["angle brackets", "<attacker@evil.com>"],
        ["a quote", 'vic"tim@example.com'],
        ["no @ at all", "not-an-address"],
        ["no dot in the domain", "user@localhost"],
        ["an empty string", ""],
        ["whitespace", "user @example.com"],
    ] as const;

    for (const [label, address] of rejected) {
        it(`refuses an address with ${label}`, async () => {
            const { sendEmail } = await loadWithProvider();

            await expect(sendEmail({ to: address, subject: "Hi", html: "<p>x</p>" }))
                .resolves.toBe(false);
            expect(providerSend).not.toHaveBeenCalled();
        });
    }

    it("refuses an address longer than the RFC limit", async () => {
        const { sendEmail } = await loadWithProvider();
        const long = "a".repeat(250) + "@example.com";

        await expect(sendEmail({ to: long, subject: "Hi", html: "<p>x</p>" }))
            .resolves.toBe(false);
        expect(providerSend).not.toHaveBeenCalled();
    });

    it("accepts an ordinary address", async () => {
        const { sendEmail } = await loadWithProvider();

        await expect(sendEmail({ to: "user.name+tag@sub.example.co.uk", subject: "Hi", html: "<p>x</p>" }))
            .resolves.toBe(true);
        expect(lastSend().to).toBe("user.name+tag@sub.example.co.uk");
    });

    it("rejects before the transport check, so a missing provider is no excuse", async () => {
        // Nothing installed: delivery is otherwise treated as successful.
        const { sendEmail } = await loadWithoutProvider();

        await expect(sendEmail({ to: "a\r\nBcc: b@c.co", subject: "Hi", html: "x" }))
            .resolves.toBe(false);
    });
});

describe("a listener that throws", () => {
    it("does not stop the mail, and the caller's own words go out", async () => {
        // The two filters run inside one try. A module that registers a
        // broken `email.subject` or `email.body` listener is a module bug,
        // and the file says the mail still goes: this is that promise.
        vi.doMock("@/core/lib/hooks", () => ({
            applyFiltersAsync: async () => { throw new Error("listener exploded"); },
        }));
        const { sendEmail } = await loadWithProvider();

        await sendEmail({
            to: "user@example.com",
            subject: "Your receipt",
            html: "<p>thanks</p>",
        });

        expect(lastSend().subject).toBe("Your receipt");
        expect(String(lastSend().html)).toContain("thanks");
        vi.doUnmock("@/core/lib/hooks");
    });
});

describe("subject sanitisation", () => {
    it("collapses a CRLF header injection into a space", async () => {
        const { sendEmail } = await loadWithProvider();

        await sendEmail({
            to: "user@example.com",
            subject: "Hello\r\nBcc: attacker@evil.com",
            html: "<p>x</p>",
        });

        const subject = lastSend().subject as string;
        expect(subject).not.toMatch(/[\r\n]/);
        expect(subject).toBe("Hello Bcc: attacker@evil.com");
    });

    it("strips NUL bytes from the subject", async () => {
        const { sendEmail } = await loadWithProvider();
        await sendEmail({ to: "user@example.com", subject: "a\0b", html: "x" });
        expect(lastSend().subject).toBe("a b");
    });

    it("clamps the subject to the RFC 5322 line limit", async () => {
        const { sendEmail } = await loadWithProvider();
        await sendEmail({ to: "user@example.com", subject: "s".repeat(2000), html: "x" });
        expect((lastSend().subject as string).length).toBe(998);
    });

    it("refuses to send when nothing survives sanitisation", async () => {
        const { sendEmail } = await loadWithProvider();

        await expect(sendEmail({ to: "user@example.com", subject: "\r\n\r\n", html: "x" }))
            .resolves.toBe(false);
        expect(providerSend).not.toHaveBeenCalled();
    });

    it("refuses an empty subject", async () => {
        const { sendEmail } = await loadWithProvider();
        await expect(sendEmail({ to: "user@example.com", subject: "", html: "x" }))
            .resolves.toBe(false);
    });
});

describe("From header", () => {
    it("is built from the configured app name and address", async () => {
        const { sendEmail } = await loadWithProvider({
            SITE_NAME: "Acme Games",
            EMAIL_FROM: "hello@acme.test",
        });

        await sendEmail({ to: "user@example.com", subject: "Hi", html: "x" });

        expect(lastSend().from).toBe("Acme Games <hello@acme.test>");
    });

    it("strips CRLF out of an operator-supplied app name", async () => {
        const { sendEmail } = await loadWithProvider({
            SITE_NAME: "Acme\r\nBcc: attacker@evil.com",
            EMAIL_FROM: "hello@acme.test",
        });

        await sendEmail({ to: "user@example.com", subject: "Hi", html: "x" });

        expect(lastSend().from).not.toMatch(/[\r\n]/);
    });

    it("falls back to this installation's own host, not the product's", async () => {
        // It used to fall back to the product's own domain, which is a host
        // an installation does not control: mail sent from it fails SPF at
        // the receiving end and a reply goes to somebody else.
        const { sendEmail } = await loadWithProvider({
            SITE_NAME: "Acme Games",
            AUTH_URL: "https://acme.test",
        });

        await sendEmail({ to: "user@example.com", subject: "Hi", html: "x" });

        expect(lastSend().from).toBe("Acme Games <noreply@acme.test>");
    });
});

// ===========================================================================
// sendEmail auditing
// ===========================================================================

describe("sendEmail auditing", () => {
    it("writes an audit row before attempting delivery", async () => {
        const { sendEmail } = await loadWithProvider();

        await sendEmail({ to: "user@example.com", subject: "Hi", html: "<p>x</p>" });

        const data = emailJob.create.mock.calls[0]![0].data;
        expect(data.status).toBe("sending");
        expect(data.attempts).toBe(1);
        expect(data.body).toBe("<p>x</p>");
        expect(data.html).toBe("<p>x</p>");
    });

    it("closes the audit row as sent", async () => {
        const { sendEmail } = await loadWithProvider();
        await sendEmail({ to: "user@example.com", subject: "Hi", html: "x" });

        const data = emailJob.update.mock.calls[0]![0].data;
        expect(data.status).toBe("sent");
        expect(data.sentAt).toBeInstanceOf(Date);
        expect(data.lastError).toBeNull();
    });

    it("closes the audit row as failed with the reason", async () => {
        const { sendEmail } = await loadWithProvider();
        providerSend.mockRejectedValue(new Error("nope"));

        await expect(sendEmail({ to: "user@example.com", subject: "Hi", html: "x" }))
            .resolves.toBe(false);
        expect(emailJob.update.mock.calls[0]![0].data).toEqual({
            status: "failed",
            lastError: "nope",
        });
    });

    it("still delivers when the audit row cannot be written", async () => {
        const { sendEmail } = await loadWithProvider();
        emailJob.create.mockRejectedValue(new Error("db down"));

        await expect(sendEmail({ to: "user@example.com", subject: "Hi", html: "x" }))
            .resolves.toBe(true);
        expect(providerSend).toHaveBeenCalledTimes(1);
        expect(emailJob.update).not.toHaveBeenCalled();
    });

    it("does not let an audit-update failure mask the real result", async () => {
        const { sendEmail } = await loadWithProvider();
        emailJob.update.mockRejectedValue(new Error("db down"));

        await expect(sendEmail({ to: "user@example.com", subject: "Hi", html: "x" }))
            .resolves.toBe(true);
    });
});

// ===========================================================================
// Transport suppression
// ===========================================================================

describe("with no transport configured", () => {
    it("treats delivery as successful so dev flows are not blocked", async () => {
        const { sendEmail } = await loadWithoutProvider();

        await expect(sendEmail({ to: "user@example.com", subject: "Hi", html: "x" }))
            .resolves.toBe(true);
        expect(providerSend).not.toHaveBeenCalled();
        expect(logWarn).toHaveBeenCalledWith(
            "email suppressed: no transport configured",
            expect.objectContaining({ to: "user@example.com" }),
        );
    });

    it("skips the password reset entirely rather than writing a job row", async () => {
        const { sendPasswordResetEmail } = await loadWithoutProvider();

        await sendPasswordResetEmail("user@example.com", "https://app.test/reset?token=abc");

        expect(emailJob.create).not.toHaveBeenCalled();
    });

    it("logs the reset link outside production so a dev can finish the flow", async () => {
        const { sendPasswordResetEmail } = await loadWithoutProvider({ NODE_ENV: "development" });

        await sendPasswordResetEmail("user@example.com", "https://app.test/reset?token=abc");

        expect(logWarn.mock.calls[0]![1]).toMatchObject({
            kind: "password-reset",
            resetUrl: "https://app.test/reset?token=abc",
        });
    });

    it("never logs the reset link in production", async () => {
        const { sendPasswordResetEmail } = await loadWithoutProvider({ NODE_ENV: "production" });

        await sendPasswordResetEmail("user@example.com", "https://app.test/reset?token=abc");

        // The token is a single-use account takeover; it must not reach the
        // log aggregator.
        expect(logWarn.mock.calls[0]![1]).not.toHaveProperty("resetUrl");
    });

    it("never logs the verification link in production", async () => {
        const { sendVerificationEmail } = await loadWithoutProvider({ NODE_ENV: "production" });

        await sendVerificationEmail("user@example.com", "https://app.test/verify?token=abc");

        expect(logWarn.mock.calls[0]![1]).not.toHaveProperty("verifyUrl");
    });

    it("logs the verification link outside production", async () => {
        const { sendVerificationEmail } = await loadWithoutProvider({ NODE_ENV: "test" });

        await sendVerificationEmail("user@example.com", "https://app.test/verify?token=abc");

        expect(logWarn.mock.calls[0]![1]).toMatchObject({
            verifyUrl: "https://app.test/verify?token=abc",
        });
    });

    it("skips the welcome mail without queueing anything", async () => {
        const { sendWelcomeEmail } = await loadWithoutProvider();

        await sendWelcomeEmail("user@example.com", "ada");

        expect(emailJob.create).not.toHaveBeenCalled();
        expect(logWarn).toHaveBeenCalledWith(
            "email suppressed: no transport configured",
            expect.objectContaining({ kind: "welcome", username: "ada" }),
        );
    });
});

// ===========================================================================
// Pre-rendered templates
// ===========================================================================

describe("password reset mail", () => {
    it("sends immediately with the localized subject", async () => {
        const { sendPasswordResetEmail } = await loadWithProvider({ SITE_NAME: "Acme" });

        await sendPasswordResetEmail("user@example.com", "https://app.test/r?t=1");

        expect(lastSend().subject).toBe("Reset your Acme password");
        expect(lastSend().html).toContain("https://app.test/r?t=1");
    });

    it("uses Turkish strings for the tr locale", async () => {
        const { sendPasswordResetEmail } = await loadWithProvider({ SITE_NAME: "Acme" });

        await sendPasswordResetEmail("user@example.com", "https://app.test/r?t=1", "tr");

        expect(lastSend().subject).toBe("Acme şifreni sıfırla");
    });

    it("falls back to English for an unknown locale", async () => {
        const { sendPasswordResetEmail } = await loadWithProvider({ SITE_NAME: "Acme" });

        await sendPasswordResetEmail("user@example.com", "https://app.test/r?t=1", "de");

        expect(lastSend().subject).toBe("Reset your Acme password");
    });

    it("escapes the reset url before interpolating it into the anchor", async () => {
        const { sendPasswordResetEmail } = await loadWithProvider();

        await sendPasswordResetEmail("user@example.com", 'https://x.test/"><script>alert(1)</script>');

        const html = lastSend().html as string;
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });
});

describe("verification mail", () => {
    it("sends immediately and escapes the verify url", async () => {
        const { sendVerificationEmail } = await loadWithProvider();

        await sendVerificationEmail("user@example.com", 'https://x.test/"><img src=x>');

        const html = lastSend().html as string;
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
    });
});

describe("the mail that moves an address", () => {
    it("sends the link to the address being claimed", async () => {
        const { sendEmailChangeVerification } = await loadWithProvider();

        await sendEmailChangeVerification("new@example.com", "a-token");

        expect(lastSend().to).toBe("new@example.com");
        expect(lastSend().html).toContain("a-token");
    });

    it("escapes what it puts in the link, like every other mail here", async () => {
        const { sendEmailChangeVerification } = await loadWithProvider();

        await sendEmailChangeVerification("new@example.com", '"><img src=x>');

        const html = lastSend().html as string;
        expect(html).not.toContain("<img");
    });

    it("warns the address on file, naming the one that was asked for", async () => {
        // The only warning this kind of hijack gives: somebody whose screen
        // was borrowed finds a message saying what was requested.
        const { sendEmailChangeNotice } = await loadWithProvider();

        await sendEmailChangeNotice("old@example.com", "new@example.com");

        expect(lastSend().to).toBe("old@example.com");
        expect(lastSend().html).toContain("new@example.com");
    });

    it("escapes the address it names in that warning", async () => {
        const { sendEmailChangeNotice } = await loadWithProvider();

        await sendEmailChangeNotice("old@example.com", '"><img src=x>@evil.test');

        expect(lastSend().html as string).not.toContain("<img");
    });

    it("sends nothing at all when the site has no way to send", async () => {
        // Both of these are security mail. Pretending to have sent one is
        // worse than the log line that says it could not.
        const { sendEmailChangeVerification, sendEmailChangeNotice } = await loadWithoutProvider();

        await sendEmailChangeVerification("new@example.com", "a-token");
        await sendEmailChangeNotice("old@example.com", "new@example.com");

        expect(providerSend).not.toHaveBeenCalled();
        expect(logWarn).toHaveBeenCalledWith(
            "email suppressed: no transport configured",
            expect.objectContaining({ kind: "email-change-notice" }),
        );
    });

    it("logs the confirmation link outside production, and never in it", async () => {
        // The same rule the password reset follows: a developer with no mail
        // transport still needs to finish the flow, and a production log is
        // not a place to write a link that moves an account.
        const dev = await loadWithoutProvider({ NODE_ENV: "development" });
        await dev.sendEmailChangeVerification("new@example.com", "a-token");
        expect(logWarn).toHaveBeenCalledWith(
            "email suppressed: no transport configured",
            expect.objectContaining({ confirmUrl: expect.stringContaining("a-token") }),
        );

        logWarn.mockClear();
        const prod = await loadWithoutProvider({ NODE_ENV: "production" });
        await prod.sendEmailChangeVerification("new@example.com", "a-token");
        expect(logWarn).toHaveBeenCalledWith(
            "email suppressed: no transport configured",
            expect.not.objectContaining({ confirmUrl: expect.anything() }),
        );
    });
});

describe("welcome mail", () => {
    it("is queued rather than sent inline", async () => {
        const { sendWelcomeEmail } = await loadWithProvider({ SITE_NAME: "Acme" });

        await sendWelcomeEmail("user@example.com", "ada");

        expect(providerSend).not.toHaveBeenCalled();
        const data = emailJob.create.mock.calls[0]![0].data;
        expect(data.status).toBe("pending");
        expect(data.subject).toBe("Welcome to Acme!");
    });

    it("escapes the username in the html body", async () => {
        const { sendWelcomeEmail } = await loadWithProvider();

        await sendWelcomeEmail("user@example.com", "<script>x</script>");

        const data = emailJob.create.mock.calls[0]![0].data;
        expect(data.html).not.toContain("<script>");
        expect(data.html).toContain("&lt;script&gt;");
    });
});

describe("account lockout mail", () => {
    const unlocksAt = new Date("2026-01-01T12:00:00.000Z");

    it("is queued even with no transport, because the lock is already armed", async () => {
        const { sendAccountLockoutEmail } = await load();

        await sendAccountLockoutEmail({ to: "user@example.com", username: "ada", unlocksAt });

        expect(emailJob.create).toHaveBeenCalledTimes(1);
        expect(emailJob.create.mock.calls[0]![0].data.status).toBe("pending");
    });

    it("names the source ip when one is known", async () => {
        const { sendAccountLockoutEmail } = await load();

        await sendAccountLockoutEmail({
            to: "user@example.com", username: "ada", unlocksAt, ip: "203.0.113.9",
        });

        expect(emailJob.create.mock.calls[0]![0].data.html).toContain("203.0.113.9");
    });

    it("omits the ip line when the address is unknown", async () => {
        const { sendAccountLockoutEmail } = await load();

        await sendAccountLockoutEmail({ to: "user@example.com", username: "ada", unlocksAt });

        expect(emailJob.create.mock.calls[0]![0].data.html).not.toContain("<code>");
    });

    it("escapes both the username and the ip", async () => {
        const { sendAccountLockoutEmail } = await load();

        await sendAccountLockoutEmail({
            to: "user@example.com",
            username: "<b>ada</b>",
            unlocksAt,
            ip: "<img src=x>",
        });

        const html = emailJob.create.mock.calls[0]![0].data.html as string;
        expect(html).not.toContain("<b>ada</b>");
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;b&gt;ada&lt;/b&gt;");
    });

    it("localizes the subject", async () => {
        const { sendAccountLockoutEmail } = await load({ SITE_NAME: "Acme" });

        await sendAccountLockoutEmail({
            to: "user@example.com", username: "ada", unlocksAt, locale: "tr",
        });

        expect(emailJob.create.mock.calls[0]![0].data.subject)
            .toBe("Acme: çok fazla başarısız giriş denemesi");
    });

    it("puts the unlock time in the plain-text body", async () => {
        const { sendAccountLockoutEmail } = await load();

        await sendAccountLockoutEmail({ to: "user@example.com", username: "ada", unlocksAt });

        expect(emailJob.create.mock.calls[0]![0].data.body).toContain(unlocksAt.toUTCString());
    });
});

/**
 * A message claimed and never finished.
 *
 * `processEmailQueue` marks a batch `sending` and then walks it, updating
 * each row as it goes. Between those two writes the process can go away: a
 * deploy, a container restart, the rebuild an install triggers. The rows it
 * had claimed keep the `sending` status, and the claim only ever looks for
 * `pending`, so nothing picks them up again. The admin screen shows them as
 * sending for as long as the database lives, and its endpoint is read-only,
 * so there is no way back through the product either.
 *
 * `deliverViaProvider` catches its own failures, so this is not the ordinary
 * error path: it is the one where nothing gets to run.
 *
 * `EmailJob` carries no `updatedAt`, and it does not need one. A `sending`
 * row's `scheduledAt` has no other meaning, so the claim stamps it and a row
 * still sending long after its stamp is one nobody is working on.
 */
describe("a message left mid-send", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        emailJob.findMany.mockResolvedValue([]);
        emailJob.updateMany.mockResolvedValue({ count: 0 });
    });

    it("is returned to the queue before the next batch is claimed", async () => {
        const { processEmailQueue } = await import("@/core/lib/email");
        await processEmailQueue();

        const recovery = emailJob.updateMany.mock.calls.find(
            ([args]) => (args as { where: { status?: string } }).where.status === "sending",
        );
        expect(recovery, "nothing sweeps a stranded claim").toBeTruthy();

        const [args] = recovery as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
        expect(args.data.status).toBe("pending");
    });

    it("only takes back a claim that has gone stale", async () => {
        const { processEmailQueue } = await import("@/core/lib/email");
        await processEmailQueue();

        const [args] = emailJob.updateMany.mock.calls.find(
            ([a]) => (a as { where: { status?: string } }).where.status === "sending",
        ) as [{ where: { scheduledAt?: { lt?: Date } } }];

        const before = args.where.scheduledAt?.lt;
        expect(before, "a sweep with no cutoff would steal a send in progress").toBeInstanceOf(Date);
        expect(before!.getTime()).toBeLessThan(Date.now());
    });

    it("counts the interruption, so a row that keeps dying is not immortal", async () => {
        const { processEmailQueue } = await import("@/core/lib/email");
        await processEmailQueue();

        const [args] = emailJob.updateMany.mock.calls.find(
            ([a]) => (a as { where: { status?: string } }).where.status === "sending",
        ) as [{ data: Record<string, unknown> }];

        expect(args.data.attempts, "without this the recovery loop has no end").toBeTruthy();
    });

    it("stamps the claim, so the sweep can tell how old it is", async () => {
        emailJob.findMany.mockResolvedValue([
            { id: "j1", to: "a@b.c", subject: "s", body: "b", html: null, attempts: 0 },
        ]);
        emailJob.updateMany.mockResolvedValue({ count: 1 });

        const { processEmailQueue } = await import("@/core/lib/email");
        await processEmailQueue();

        const claim = emailJob.updateMany.mock.calls.find(
            ([a]) => (a as { data: { status?: string } }).data.status === "sending",
        );
        expect(claim, "no call claims a batch").toBeTruthy();
        const [args] = claim as [{ data: { scheduledAt?: Date } }];
        expect(args.data.scheduledAt, "an unstamped claim cannot be aged").toBeInstanceOf(Date);
    });
});
