import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What the personal data export owes the person asking for it.
 *
 * Two things go wrong here and neither shows from the outside, because a
 * bundle that is missing half a life still unzips and still looks complete.
 *
 * It shipped a credential. Every core table was read with a bare `findMany`,
 * and Prisma answers a query with no `select` by returning every column, so
 * `sessions` carried `UserSession.tokenId` - the claim a JWT carries and the
 * row a session is looked up by when it is checked for revocation. The route
 * that lists sessions on screen had already been fixed to withhold it; the
 * export had not.
 *
 * And it left tables out. Fourteen core models hold a relation to User and
 * five were exported: a user's direct messages, their OAuth sign-in links,
 * their API keys, their uploaded files and their audit trail were all absent,
 * while the README told them the bundle held "every row in our database that
 * references your account" and named OAuth providers specifically. Four
 * module tables were undeclared, and `creditTransaction` was declared by
 * `credits` for a model that lives in `store`'s schema, so an instance
 * running the store without the credits module exported no transactions.
 *
 * Both failures are the same shape: a table is added, and nothing says the
 * export has an opinion about it. So the source lists what it hands out and
 * what it withholds, and this file requires one or the other for everything
 * a schema declares.
 */

vi.mock("@/core/lib/db", () => ({ prisma: {} }));
vi.mock("@/core/generated/module-registry", () => ({ ModuleUserDataTables: [] }));

const ROOT = process.cwd();

/** Column names that are a secret by their name alone. */
const SECRET_NAME = /(password|secret|token|apikey|privatekey|backupcodes|keyhash)/i;

/** Names the rule above would take for secrets and which are not. */
const NOT_SECRET = new Set(["token_type", "tokenExpiresAt", "twoFactorEnabled", "passwordChangedAt"]);

const isSecret = (column: string) => SECRET_NAME.test(column) && !NOT_SECRET.has(column);

interface Model {
    /** Every field name, relation fields included. */
    columns: string[];
    /** Scalar columns holding a foreign key to User. */
    userColumns: string[];
}

/** The models a schema file declares, keyed by the Prisma delegate name. */
function parseSchema(file: string): Map<string, Model> {
    const out = new Map<string, Model>();
    if (!fs.existsSync(file)) return out;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
        const [, name, body] = match;
        const columns: string[] = [];
        const userColumns: string[] = [];
        for (const line of body.split("\n")) {
            const field = /^\s*(\w+)\s+\S/.exec(line);
            if (!field) continue;
            columns.push(field[1]);
            if (/^\s*\w+\s+User\??\s/.test(line) && line.includes("@relation")) {
                const fk = /fields:\s*\[(\w+)\]/.exec(line);
                if (fk) userColumns.push(fk[1]);
            }
        }
        out.set(name, { columns, userColumns });
    }
    return out;
}

const delegateName = (model: string) => model[0].toLowerCase() + model.slice(1);

const core = parseSchema(path.join(ROOT, "prisma/schema.core.prisma"));

async function exportModule() {
    return import("@/core/lib/user-data-export");
}

describe("the core tables", () => {
    it("cover every model that holds a relation to User, or say why not", async () => {
        const { CORE_TABLES, CORE_TABLES_WITHHELD } = await exportModule();
        const exported = new Set(CORE_TABLES.map((t) => t.model));

        const undecided: string[] = [];
        let related = 0;
        for (const [name, model] of core) {
            if (model.userColumns.length === 0) continue;
            related++;
            if (exported.has(delegateName(name))) continue;
            if (CORE_TABLES_WITHHELD[name]) continue;
            undecided.push(name);
        }

        expect(related).toBeGreaterThan(10); // the scan found the schema
        expect(undecided).toEqual([]);
    });

    it("gives a reason for each one it withholds, and withholds nothing twice", async () => {
        const { CORE_TABLES, CORE_TABLES_WITHHELD } = await exportModule();
        const exported = new Set(CORE_TABLES.map((t) => t.model));

        for (const [name, reason] of Object.entries(CORE_TABLES_WITHHELD)) {
            expect(core.has(name), `${name} is not a core model`).toBe(true);
            expect(reason.length, `${name} has no reason`).toBeGreaterThan(20);
            expect(exported.has(delegateName(name)), `${name} is both exported and withheld`).toBe(false);
        }
    });

    it("joins on a column that really points at the user", async () => {
        const { CORE_TABLES } = await exportModule();
        const wrong: string[] = [];
        for (const table of CORE_TABLES) {
            const model = [...core].find(([name]) => delegateName(name) === table.model)?.[1];
            if (!model) {
                wrong.push(`${table.model} is not in the core schema`);
                continue;
            }
            if (model.userColumns.includes(table.column)) continue;
            // A polymorphic principal has no foreign key to anything: the
            // column holds a role id as readily as a user id, and the entry
            // says which with a `where`. Requiring that filter is what keeps
            // "no relation" from becoming "any column will do".
            if (table.where && Object.keys(table.where).length > 0) {
                if (!model.columns.includes(table.column)) {
                    wrong.push(`${table.model}.${table.column} is not a column of the model`);
                }
                continue;
            }
            wrong.push(`${table.model}.${table.column} is not a User foreign key (has ${model.userColumns.join(", ")})`);
        }
        expect(wrong).toEqual([]);
    });

    it("selects only columns the model actually has", async () => {
        // Prisma rejects an unknown key in `select`, and the export swallows
        // the error, so one typo turns a whole table into an empty array
        // that reads exactly like "you have no data here".
        const { CORE_TABLES } = await exportModule();
        const unknown: string[] = [];
        for (const table of CORE_TABLES) {
            const model = [...core].find(([name]) => delegateName(name) === table.model)?.[1];
            if (!model) continue; // reported above
            for (const column of Object.keys(table.select)) {
                if (!model.columns.includes(column)) unknown.push(`${table.model}.${column}`);
            }
        }
        expect(unknown).toEqual([]);
    });

    it("names its columns rather than taking whatever the schema holds", async () => {
        const { CORE_TABLES } = await exportModule();
        for (const table of CORE_TABLES) {
            expect(Object.keys(table.select).length, `${table.model} selects nothing`).toBeGreaterThan(0);
        }
    });

    it("hands out no column that is a secret by name", async () => {
        const { CORE_TABLES } = await exportModule();
        const leaked: string[] = [];
        for (const table of CORE_TABLES) {
            for (const column of Object.keys(table.select)) {
                if (isSecret(column)) leaked.push(`${table.model}.${column}`);
            }
        }
        expect(leaked).toEqual([]);
    });

    it("withholds the four columns this was written for", async () => {
        const { CORE_TABLES } = await exportModule();
        const columns = (model: string) => Object.keys(CORE_TABLES.find((t) => t.model === model)?.select ?? {});

        // The revocation key for a live session.
        expect(columns("userSession")).not.toContain("tokenId");
        expect(columns("userSession")).toContain("ipAddress");
        // Live credentials for the provider account.
        for (const column of ["refresh_token", "access_token", "id_token", "session_state"]) {
            expect(columns("account")).not.toContain(column);
        }
        expect(columns("account")).toContain("provider");
        // The verifier for the API key itself.
        expect(columns("apiKey")).not.toContain("keyHash");
        expect(columns("apiKey")).toContain("keyPrefix");
        // An admin action records the account it acted on.
        expect(columns("activityLog")).not.toContain("metadata");
        expect(columns("activityLog")).toContain("action");
    });

    it("keys each table distinctly, and not over the two fixed keys", async () => {
        const { CORE_TABLES } = await exportModule();
        const keys = CORE_TABLES.map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).not.toContain("user");
        expect(keys).not.toContain("modules");
    });
});

describe("the README", () => {
    it("names every key the bundle carries", async () => {
        const { CORE_TABLES, buildExportReadme } = await exportModule();
        const readme = buildExportReadme("usr_1", new Date(), "Acme Games");
        for (const table of CORE_TABLES) {
            expect(readme, `${table.key} is undocumented`).toContain(table.key);
        }
        expect(readme).toContain("modules");
    });

    it("says that some rows are held back, rather than claiming to hold everything", async () => {
        const { buildExportReadme } = await exportModule();
        const readme = buildExportReadme("usr_1", new Date(), "Acme Games");
        // It used to promise "every row in our database that references your
        // account" and then name OAuth providers, neither of which was true.
        expect(readme).toMatch(/withheld on purpose/i);
        expect(readme).toMatch(/access tokens themselves\s+are omitted/i);
    });
});

describe("what a module declares", () => {
    const dir = path.join(ROOT, "module-sources");
    const modules = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => fs.existsSync(path.join(dir, name, "module.json")))
        .map((name) => ({
            id: name,
            manifest: JSON.parse(fs.readFileSync(path.join(dir, name, "module.json"), "utf8")) as {
                userDataExport?: { model: string; key: string; column: string }[];
            },
            schema: parseSchema(path.join(dir, name, "schema.prisma")),
        }));

    it("finds the manifests at all", () => {
        expect(modules.length).toBeGreaterThan(50);
        expect(modules.filter((m) => m.manifest.userDataExport?.length).length).toBeGreaterThan(5);
    });

    it("names a model out of its own schema, on a column that model has", () => {
        // `credits` declared `creditTransaction`, which lives in `store`'s
        // schema: an instance running the store without credits wrote rows
        // nothing exported, and the two modules could be uninstalled
        // independently with no build error either way.
        const wrong: string[] = [];
        for (const { id, manifest, schema } of modules) {
            for (const entry of manifest.userDataExport ?? []) {
                const model = [...schema].find(([name]) => delegateName(name) === entry.model)?.[1];
                if (!model) {
                    wrong.push(`${id}: ${entry.model} is not in ${id}/schema.prisma`);
                } else if (!model.columns.includes(entry.column)) {
                    wrong.push(`${id}: ${entry.model} has no column ${entry.column}`);
                }
            }
        }
        expect(wrong).toEqual([]);
    });

    it("declares every one of its models that points at a user", () => {
        const undeclared: string[] = [];
        let related = 0;
        for (const { id, manifest, schema } of modules) {
            const declared = new Set((manifest.userDataExport ?? []).map((e) => e.model));
            for (const [name, model] of schema) {
                if (model.userColumns.length === 0) continue;
                related++;
                if (!declared.has(delegateName(name))) undeclared.push(`${id}: ${name} (${model.userColumns.join(", ")})`);
            }
        }
        expect(related).toBeGreaterThan(20); // the scan found the schemas
        expect(undeclared).toEqual([]);
    });

    it("declares no model carrying a secret column", () => {
        // Module tables are exported whole - the manifest has no way to name
        // columns - so a model with a secret in it cannot be declared until
        // that contract grows one.
        const leaky: string[] = [];
        for (const { id, manifest, schema } of modules) {
            for (const entry of manifest.userDataExport ?? []) {
                const model = [...schema].find(([name]) => delegateName(name) === entry.model)?.[1];
                for (const column of model?.columns ?? []) {
                    if (isSecret(column)) leaky.push(`${id}: ${entry.model}.${column}`);
                }
            }
        }
        expect(leaky).toEqual([]);
    });

    it("keys its tables without colliding with another module", () => {
        const seen = new Map<string, string>();
        const clashes: string[] = [];
        for (const { id, manifest } of modules) {
            for (const entry of manifest.userDataExport ?? []) {
                const owner = seen.get(entry.key);
                if (owner && owner !== id) clashes.push(`${entry.key}: ${owner} and ${id}`);
                else seen.set(entry.key, id);
            }
        }
        expect(clashes).toEqual([]);
    });
});
