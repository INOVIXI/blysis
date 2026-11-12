/**
 * Which database a connection string names.
 *
 * LibertyBans stores in HSQLDB out of the box and can be pointed at MariaDB,
 * MySQL, PostgreSQL or CockroachDB. HSQLDB is a file the server process holds
 * open, so an operator who wants this has to move LibertyBans onto one of the
 * others first, and the settings screen says so rather than failing later with
 * a driver error. CockroachDB speaks PostgreSQL's protocol and is read as one.
 *
 * Read from the scheme rather than sniffed from the port or the shape. A string
 * naming anything else is refused instead of defaulted: opening a socket to
 * whatever host a `mongodb://` string names is a connection nobody asked for,
 * made with somebody's credentials.
 *
 * `minecraft-litebans` makes the same decision in a file of its own, and that
 * is a copy on purpose: a module may not import another module's code.
 */

export type Dialect = "postgres" | "mysql";

const SCHEMES: Record<string, Dialect> = {
    "postgres:": "postgres",
    "postgresql:": "postgres",
    "mysql:": "mysql",
    // The same wire protocol and the same driver. LibertyBans' own default
    // for a remote database is MariaDB, so this is the address most operators
    // will paste.
    "mariadb:": "mysql",
};

export function dialectOf(connectionString: string): Dialect | null {
    const trimmed = connectionString.trim();
    if (trimmed === "") return null;
    // Parsed as a URL rather than matched by prefix: `mysqlish://` starts with
    // `mysql` and is not one.
    try {
        return SCHEMES[new URL(trimmed).protocol] ?? null;
    } catch {
        return null;
    }
}
