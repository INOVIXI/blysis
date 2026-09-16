import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { hasPermission, isAdmin } from "@/core/lib/permissions";
import { ModuleSecretSettings } from "@/core/generated/module-data";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { logActivity } from "@/core/lib/activity-log";
import { invalidate } from "@/core/lib/cache";
import { invalidateEmailConfig } from "@/core/lib/email-config";
import { sanitizeCustomCss, CSS_SANITIZED_SETTING_KEYS } from "@/core/lib/css-sanitizer";
import { readJsonBody } from "@/core/lib/api-body";
import { log } from "@/core/lib/logger";
import { isSecretSetting, settingsForStorage, withoutSecrets } from "@/core/lib/secret-settings";

const settingKeySchema = z.string().regex(/^[a-zA-Z0-9_]+$/, "Invalid setting key format");
// Value is a Json column - accept any JSON-serializable value (string, number, boolean, array, object, null)
// Max serialized size: 100KB to prevent abuse
const settingsBodySchema = z.record(settingKeySchema, z.unknown()).refine(
    (data) => JSON.stringify(data).length <= 100_000,
    { message: "Settings payload too large (max 100KB)" }
);

// Per-key max string length for public-facing settings. These values are
// served to every visitor via /api/v1/public-settings, so a careless admin
// (or a compromised account) could otherwise inflate the anonymous response
// to tens of MB. Keys not listed here fall back to the 100KB overall cap.
const PER_KEY_STRING_LIMITS: Record<string, number> = {
    custom_css: 200_000,      // 200KB - stylesheets can be legitimately big
    site_name: 100,
    site_description: 500,
    site_email: 254,
    site_discord_url: 500,
    footer_about_text: 2_000,
    footer_columns: 24_000,
    footer_quick_links: 8_000,
    footer_legal_links: 8_000,
    footer_copyright: 300,
    password_hash_algorithm: 16,
    username_rule: 32,
    currency: 16,
    currency_symbol: 8,
};

// GET /api/v1/settings
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await prisma.setting.findMany();

    // Convert to key-value map
    const settingsMap: Record<string, unknown> = {};
    for (const s of settings) {
        settingsMap[s.key] = s.value;
    }

    // A credential is never in this response. The screens that write one show
    // a password input, which hides the value from somebody standing behind
    // the admin and from nothing else: an extension reads the DOM, and this
    // JSON is a request body away from any log that records one. What a screen
    // needs in order to let an operator replace a key is not the key, it is
    // whether one is stored - which is what `secretsConfigured` says.
    const { settings: visible, secretsConfigured } = withoutSecrets(settingsMap);

    return NextResponse.json({ settings: visible, secretsConfigured });
}

// PATCH /api/v1/settings - Bulk update settings
export async function PATCH(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    // Validate settings keys and values
    const parsed = settingsBodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid settings data", issues: parsed.error.issues },
            { status: 400 }
        );
    }

    // A payment key, a mail credential, a webhook secret. Writing one is not
    // the same act as renaming the site, and this endpoint is how both are
    // done, so the permission is asked for here rather than at the door. The
    // set is what the installed modules declared, never a list core keeps.
    const secrets = new Set(ModuleSecretSettings.map((entry) => entry.split(".")[0]));
    const touchesCredential = Object.keys(parsed.data).some((key) => secrets.has(key));
    if (touchesCredential && !(await hasPermission(session.user.id, "admin.settings.credentials"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Pre-flight per-key string length cap. Enforced BEFORE any writes so a
    // rejection doesn't leave the DB with a mix of accepted + rejected keys.
    for (const [key, rawValue] of Object.entries(parsed.data)) {
        const limit = PER_KEY_STRING_LIMITS[key];
        if (typeof rawValue === "string" && limit !== undefined && rawValue.length > limit) {
            return NextResponse.json(
                { error: `Setting "${key}" exceeds the ${limit}-character limit` },
                { status: 400 },
            );
        }
        // A credential is a string or it is nothing. The column is JSON, so
        // without this a number would be stored unsealed beside keys that are
        // sealed, and the module reading it would get a value the boundary
        // never saw.
        if (isSecretSetting(key) && typeof rawValue !== "string") {
            return NextResponse.json(
                { error: `Setting "${key}" must be a string` },
                { status: 400 },
            );
        }
    }

    // Upsert each setting. Setting.value is Json; cast through InputJsonValue.
    // String values for CSS-sanitized keys are scrubbed so a compromised
    // admin account cannot persist a payload that breaks out of the <style>
    // tag injected on every public page.
    //
    // One transaction, because a settings form is one save: the site form
    // sends nine keys and the general form sends more, and a failure on the
    // fifth used to leave four of them written under a message that said the
    // save had failed. The pre-flight above already keeps a *rejection* from
    // writing anything; this covers the write itself giving out halfway.

    // Sealed before the write, so no path into the column skips it. A key a
    // module declared in `secretSettings` goes in as ciphertext; everything
    // else goes in as it arrived. An empty string stays empty, because
    // clearing a key is how an operator removes a gateway.
    //
    // Sealing needs SECRET_ENCRYPTION_KEY, and an install that upgraded
    // without setting one throws here rather than storing the credential in
    // the clear. That refusal has to be legible: the fix is one environment
    // variable, and an operator reading "could not save" under a payment form
    // has no way to reach it. Nothing is written either - the throw happens
    // before the transaction, so a body carrying a credential and a site name
    // saves neither, which is the same all-or-nothing this endpoint already
    // promises.
    let forStorage: Record<string, unknown>;
    try {
        forStorage = settingsForStorage(parsed.data);
    } catch (error) {
        log.error("settings: could not encrypt a credential", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
            {
                error:
                    "This server cannot store a credential: SECRET_ENCRYPTION_KEY is missing " +
                    "or is not a 64-character hex value. Set it, restart, and save again.",
                code: "secret_key_missing",
            },
            { status: 500 },
        );
    }

    await prisma.$transaction(
        Object.entries(forStorage).map(([key, rawValue]) => {
            const value = CSS_SANITIZED_SETTING_KEYS.has(key)
                ? sanitizeCustomCss(rawValue)
                : rawValue;
            const jsonValue = (value ?? Prisma.JsonNull) as Prisma.InputJsonValue;
            return prisma.setting.upsert({
                where: { key },
                update: { value: jsonValue },
                create: { key, value: jsonValue },
            });
        }),
    );

    // Drop the cached public-settings payload so clients see fresh values
    // immediately instead of waiting out the 60s TTL.
    await invalidate("public-settings");
    // The mailer keeps its transport for ten seconds; an admin who has just
    // pasted an API key should be able to send a test message straight away.
    invalidateEmailConfig();

    logActivity({
        userId: session.user.id,
        action: "settings.update",
        entity: "setting",
        metadata: { keys: Object.keys(parsed.data) },
    }).catch(() => {});

    return NextResponse.json({ message: "Settings updated" });
}
