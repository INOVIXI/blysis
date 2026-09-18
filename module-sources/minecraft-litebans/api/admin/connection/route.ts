import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, logActivity, prisma, readJsonBody, readSettingValues, settingsForStorage } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { dialectOf } from "../../../lib/dialect";
import { withLiteBans, wantedColumns } from "../../../lib/read";
import { CONFIG_KEY, configFrom } from "../../../lib/settings";
import { syncLiteBans } from "../../../lib/sync";
import { PUNISHMENT_TABLES } from "../../../lib/tables";

/**
 * The connection an operator configures, and a way to find out whether it
 * works before trusting it.
 *
 * The trial run is why this has a POST as well as a PUT. An operator typing a
 * database address and a table prefix into a production admin has otherwise no
 * way to learn they got the prefix wrong until a scheduler tick five minutes
 * later logs something they will never read. The answer names the kind of
 * failure and never the driver's own sentence, which carries the host, the
 * user and sometimes the password in full.
 *
 * The address never comes back out. It is a credential - a database user on
 * somebody's game server - so the screen is told whether one is stored and
 * never what it is, and a save that leaves the field blank keeps the one
 * already there rather than clearing it.
 */

const saveSchema = z.object({
    /** Blank means "leave the stored one alone", which is how the field can be write-only. */
    connection: z.string().max(500).default(""),
    prefix: z.string().max(40).default("litebans_"),
    enabled: z.boolean().default(false),
    /** Names the place when a row's own `server_scope` is empty. */
    scopeKey: z.string().max(120).default(""),
});

const actionSchema = z.object({ action: z.enum(["test", "sync", "resync"]) });

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!(await isAdmin(session.user.id))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    return { session };
}

/** The configuration as a screen may see it, plus where each kind's read got to. */
export async function GET() {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const values = await readSettingValues([CONFIG_KEY]);
    const config = configFrom(values[CONFIG_KEY]);
    const cursors = await prisma.liteBansSync.findMany({ orderBy: { kind: "asc" }, take: 20 });

    return NextResponse.json(
        {
            configured: config.connection !== "",
            prefix: config.prefix,
            enabled: config.enabled,
            scopeKey: config.scopeKey,
            cursors: cursors.map((row) => ({
                kind: row.kind,
                lastId: Number(row.lastId),
                syncedAt: row.syncedAt.toISOString(),
            })),
        },
        { headers: { "Cache-Control": "private, no-store" } },
    );
}

export async function PUT(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", code: "invalid_config" }, { status: 400 });

    const values = await readSettingValues([CONFIG_KEY]);
    const stored = configFrom(values[CONFIG_KEY]);
    const connection = parsed.data.connection.trim() || stored.connection;

    if (connection !== "" && !dialectOf(connection)) {
        return NextResponse.json(
            { error: "That address names a database this cannot read", code: "unknown_dialect" },
            { status: 400 },
        );
    }

    // Refused here rather than at read time, for the same reason the reader
    // refuses it: a prefix that is not an identifier would be concatenated
    // into a query. Saving it and failing later means every run fails with
    // nothing on the screen that saved it to say why.
    const prefix = parsed.data.prefix.trim() || "litebans_";
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(`${prefix}bans`)) {
        return NextResponse.json({ error: "That is not a table prefix", code: "bad_prefix" }, { status: 400 });
    }

    const config = {
        connection,
        prefix,
        enabled: parsed.data.enabled && connection !== "",
        scopeKey: parsed.data.scopeKey.trim(),
    };
    await prisma.setting.upsert({
        where: { key: CONFIG_KEY },
        // Sealed on the way in: `secretSettings` in the manifest names
        // `minecraft_litebans_config.connection`, and this is the one boundary
        // that honours it.
        update: { value: settingsForStorage({ [CONFIG_KEY]: config })[CONFIG_KEY] as object },
        create: {
            key: CONFIG_KEY,
            value: settingsForStorage({ [CONFIG_KEY]: config })[CONFIG_KEY] as object,
            // Uninstall deletes a module's settings by this column. Untagged,
            // the row defaults to core's and outlives the module that wrote
            // it - and this row holds a credential.
            module: "minecraft-litebans",
        },
    });

    logActivity({
        userId: guard.session?.user?.id,
        action: "minecraft-litebans.connection.saved",
        entity: "setting",
        entityId: CONFIG_KEY,
        // The prefix and the switch, never the address. An activity row is
        // read in more places than this screen is.
        metadata: { prefix, enabled: config.enabled, scopeKey: config.scopeKey },
    }).catch(() => {});

    return NextResponse.json({ saved: true, configured: connection !== "", enabled: config.enabled });
}

/** Try the connection, or run a read now. */
export async function POST(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    if (parsed.data.action !== "test") {
        const summary = await syncLiteBans({ full: parsed.data.action === "resync" });
        return NextResponse.json({ summary }, { status: summary.failed ? 502 : 200 });
    }

    const values = await readSettingValues([CONFIG_KEY]);
    const config = configFrom(values[CONFIG_KEY]);
    if (config.connection === "") {
        return NextResponse.json({ error: "Nothing is connected yet", code: "not_connected" }, { status: 400 });
    }
    const dialect = dialectOf(config.connection);
    if (!dialect) {
        return NextResponse.json({ error: "That address names a database this cannot read", code: "unknown_dialect" }, { status: 400 });
    }

    /*
     * What the trial actually proves: that the address opens, that the tables
     * are where the prefix says, and that each has the columns a record needs.
     * A connection that opens onto the wrong database passes every other check
     * an operator could make from here.
     */
    const outcome = await withLiteBans(config.connection, dialect, async (reader) => {
        const found: { kind: string; ok: boolean }[] = [];
        for (const table of PUNISHMENT_TABLES) {
            const columns = await reader.columnsOf(`${config.prefix}${table.suffix}`);
            found.push({ kind: table.kind, ok: wantedColumns(columns) !== null });
        }
        return found;
    });

    if ("failed" in outcome) {
        return NextResponse.json({ error: outcome.message, code: `litebans_${outcome.failed.replace(/-/g, "_")}` }, { status: 502 });
    }

    return NextResponse.json({ tables: outcome.value });
}
