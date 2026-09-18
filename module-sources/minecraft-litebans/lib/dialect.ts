/**
 * Which database a connection string names.
 *
 * LiteBans stores in H2 out of the box and can be pointed at MySQL, MariaDB,
 * PostgreSQL or SQLite. Two of those are readable from here: H2 is a Java
 * database whose file the server process holds open, and SQLite lives on the
 * game server's disk rather than on a socket. So an operator who wants this
 * has to move LiteBans onto MySQL or PostgreSQL first, and the settings screen
 * says so rather than failing later with a driver error.
 *
 * Read from the scheme rather than sniffed from the port or the shape. A
 * string naming anything else is refused instead of defaulted: opening a
 * Postgres socket to whatever host a `mongodb://` string names is a connection
 * nobody asked for, made with somebody's credentials.
 *
 * This is a second copy of a decision `external-data` also makes, and it is a
 * copy on purpose. A module may not import another module's code, and the two
 * do not have to move together: the day this one learns to read a third
 * database is a day about LiteBans, not about publishing a list.
 */

export type Dialect = "postgres" | "mysql";

const SCHEMES: Record<string, Dialect> = {
    "postgres:": "postgres",
    "postgresql:": "postgres",
    "mysql:": "mysql",
    // The same wire protocol and the same driver. An operator who copied the
    // address out of LiteBans' own config.yml should not have to edit it.
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
