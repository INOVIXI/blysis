import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, prisma, readJsonBody, settingsForStorage, withoutSecrets } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

const SETTING_KEY = "cloudflare_r2_config";
const ACTIVE_KEY = "storage_active_provider";

const configSchema = z.object({
    accountId: z.string().min(1),
    bucket: z.string().min(1),
    accessKey: z.string().min(1),
    // Empty is "leave the stored one alone", which is the only way a screen
    // that never receives the credential can save its other fields.
    secretKey: z.string().default(""),
    publicUrl: z.string().url(),
    setActive: z.boolean().optional(),
    /*
     * Whether the database backups are copied here, and where in the bucket
     * they land. Both optional: a save from a screen that predates them must
     * not read as "stop keeping backups".
     */
    keepBackups: z.boolean().optional(),
    backupPrefix: z.string().max(120).optional(),
});

/** The stored config exactly as it is, for a save that is not changing all of it. */
async function stored(): Promise<Record<string, unknown>> {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const value = row?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [config, active] = await Promise.all([
        prisma.setting.findUnique({ where: { key: SETTING_KEY } }),
        prisma.setting.findUnique({ where: { key: ACTIVE_KEY } }),
    ]);

    // The secret access key is not in this response. An admin who wants to
    // change it types a new one; an admin who does not leaves the field alone.
    // Sending it back only to have the form send it again put the credential
    // in two more places on every visit to this screen.
    const { settings, secretsConfigured } = withoutSecrets({
        [SETTING_KEY]: config?.value ?? null,
    });

    return NextResponse.json({
        config: settings[SETTING_KEY] || null,
        secretsConfigured,
        isActive: active?.value === "cloudflare-r2" || (typeof active?.value === "object" && active?.value && (active.value as { id?: string }).id === "cloudflare-r2"),
    });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request, { fallback: null });
    if (body instanceof NextResponse) return body;
    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid config" }, { status: 400 });
    }

    const { setActive, keepBackups, backupPrefix, ...config } = parsed.data;
    const before = await stored();

    // An empty secret key means the admin left the field alone, so the stored
    // one stays. Without this, saving any other field on the screen would
    // erase the credential and every upload would start failing.
    const kept = config.secretKey === ""
        ? (typeof before.secretKey === "string" ? before.secretKey : "")
        : config.secretKey;

    // A field the request did not mention keeps what it had. A screen from an
    // older version of this module sends neither of these, and dropping them
    // would read as "stop keeping backups here" on the first save.
    const value = settingsForStorage({
        [SETTING_KEY]: {
            ...config,
            secretKey: kept,
            keepBackups: keepBackups ?? before.keepBackups === true,
            backupPrefix: backupPrefix ?? (typeof before.backupPrefix === "string" ? before.backupPrefix : ""),
        },
    })[SETTING_KEY];

    await prisma.setting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: value as object, module: "cloudflare-r2" },
        update: { value: value as object },
    });

    if (setActive) {
        await prisma.setting.upsert({
            where: { key: ACTIVE_KEY },
            create: { key: ACTIVE_KEY, value: "cloudflare-r2", module: "core" },
            update: { value: "cloudflare-r2" },
        });
    }

    return NextResponse.json({ ok: true });
}
