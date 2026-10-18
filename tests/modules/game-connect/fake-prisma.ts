/**
 * An in-memory stand-in for the part of Prisma game-connect uses.
 *
 * It reads the same `where` objects the module writes: plain equality, `in`,
 * `lt`, `gt`, `gte`, `lte`, `not`, `equals` with `mode: "insensitive"`, `OR`
 * and `AND`. That is enough to test the queue's conditional writes as written,
 * rather than as a mock that answers whatever the test expects.
 */
import { vi } from "vitest";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function compare(value: unknown, condition: unknown): boolean {
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition !== "object") return value === condition;
    const c = condition as Record<string, unknown>;
    const v = value instanceof Date ? value.getTime() : value;
    const n = (x: unknown) => (x instanceof Date ? x.getTime() : x);
    if ("in" in c && !(c.in as unknown[]).map(n).includes(v)) return false;
    if ("lt" in c && !(v !== null && v !== undefined && (v as number) < (n(c.lt) as number))) return false;
    if ("lte" in c && !(v !== null && v !== undefined && (v as number) <= (n(c.lte) as number))) return false;
    if ("gt" in c && !(v !== null && v !== undefined && (v as number) > (n(c.gt) as number))) return false;
    if ("gte" in c && !(v !== null && v !== undefined && (v as number) >= (n(c.gte) as number))) return false;
    if ("not" in c && compare(value, c.not)) return false;
    if ("equals" in c) {
        if (c.mode === "insensitive") {
            if (String(value).toLowerCase() !== String(c.equals).toLowerCase()) return false;
        } else if (value !== c.equals) return false;
    }
    return true;
}

export function matches(row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [key, condition] of Object.entries(where)) {
        if (key === "OR") {
            if (!(condition as Where[]).some((w) => matches(row, w))) return false;
        } else if (key === "AND") {
            if (!(condition as Where[]).every((w) => matches(row, w))) return false;
        } else if (!compare(row[key], condition)) {
            return false;
        }
    }
    return true;
}

function ordered(rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, "asc" | "desc">[];
    return [...rows].sort((a, b) => {
        for (const key of keys) {
            const [field, direction] = Object.entries(key)[0];
            const x = a[field] instanceof Date ? (a[field] as Date).getTime() : (a[field] as number);
            const y = b[field] instanceof Date ? (b[field] as Date).getTime() : (b[field] as number);
            if (x === y) continue;
            const less = x === null || x === undefined ? true : y === null || y === undefined ? false : x < y;
            return (less ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
        return 0;
    });
}

function pick(row: Row, select: Record<string, boolean> | undefined): Row {
    if (!select) return { ...row };
    return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
}

export interface FakeTable {
    rows: Row[];
}

let counter = 0;

export function fakeTable(defaults: () => Row = () => ({}), idField = "id") {
    const table: FakeTable = { rows: [] };
    const api = {
        table,
        create: vi.fn(async ({ data }: { data: Row }) => {
            const row: Row = { ...defaults(), ...data };
            if (row[idField] === undefined) row[idField] = idField === "seq" ? ++counter : `id${++counter}`;
            table.rows.push(row);
            return { ...row };
        }),
        createMany: vi.fn(async ({ data }: { data: Row[] }) => {
            for (const d of data) await api.create({ data: d });
            return { count: data.length };
        }),
        findUnique: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
            const row = table.rows.find((r) => matches(r, where));
            return row ? pick(row, select) : null;
        }),
        findFirst: vi.fn(async ({ where, orderBy, select }: { where?: Where; orderBy?: unknown; select?: Record<string, boolean> }) => {
            const row = ordered(table.rows.filter((r) => matches(r, where)), orderBy)[0];
            return row ? pick(row, select) : null;
        }),
        findMany: vi.fn(
            async ({ where, orderBy, take, select }: { where?: Where; orderBy?: unknown; take?: number; select?: Record<string, boolean> } = {}) =>
                ordered(table.rows.filter((r) => matches(r, where)), orderBy)
                    .slice(0, take ?? Infinity)
                    .map((r) => pick(r, select)),
        ),
        count: vi.fn(async ({ where }: { where?: Where } = {}) => table.rows.filter((r) => matches(r, where)).length),
        update: vi.fn(async ({ where, data }: { where: Where; data: Row }) => {
            const row = table.rows.find((r) => matches(r, where));
            if (!row) throw new Error("Record to update not found");
            Object.assign(row, data);
            return { ...row };
        }),
        updateMany: vi.fn(async ({ where, data }: { where?: Where; data: Row }) => {
            const hit = table.rows.filter((r) => matches(r, where));
            for (const row of hit) Object.assign(row, data);
            return { count: hit.length };
        }),
        delete: vi.fn(async ({ where }: { where: Where }) => {
            const index = table.rows.findIndex((r) => matches(r, where));
            if (index < 0) throw new Error("Record to delete does not exist");
            return table.rows.splice(index, 1)[0];
        }),
        deleteMany: vi.fn(async ({ where }: { where?: Where } = {}) => {
            const before = table.rows.length;
            table.rows = table.rows.filter((r) => !matches(r, where));
            return { count: before - table.rows.length };
        }),
    };
    return api;
}

/**
 * Runs a callback transaction against the same tables, or a list of promises.
 * A callback that throws leaves every table as it found it, as Postgres would.
 */
export function fakeTransaction(client: object, tables: FakeTable[]) {
    return vi.fn(async (arg: unknown) => {
        if (typeof arg !== "function") return Promise.all(arg as Promise<unknown>[]);
        const snapshot = tables.map((t) => t.rows.map((r) => ({ ...r })));
        try {
            return await (arg as (tx: object) => Promise<unknown>)(client);
        } catch (error) {
            tables.forEach((t, i) => {
                t.rows = snapshot[i];
            });
            throw error;
        }
    });
}
