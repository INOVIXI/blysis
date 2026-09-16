/**
 * The record, written by the server.
 *
 * The list below stays a client component - searching, filtering and paging
 * are its job - but it used to fetch the first page on mount, so the HTML the
 * server sent carried no entry: measured, 117 characters of text inside
 * `<main>`.
 *
 * `readPunishments` holds what a filter means, and the endpoint calls it too.
 */
import { readPunishments } from "../../lib/read-punishments";
import { PunishmentList } from "../../components/PunishmentList";

export default async function PunishmentsPage() {
    const read = await readPunishments({ page: 1 });
    // The two dates cross the boundary as the strings the list already
    // expected of the endpoint, so nothing below had to learn a second shape.
    const rows = read.punishments.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    }));
    return <PunishmentList initial={rows} initialPages={read.pages} />;
}
