/**
 * The vote sites, written by the server.
 *
 * The list below stays a client component because pressing a site records the
 * vote and opens it, but the list itself used to be fetched on mount - so the
 * HTML the server sent carried no site and no reward: measured, 147 characters
 * of text inside `<main>`.
 */
import { getLocale } from "next-intl/server";
import { readVoteSites } from "../../lib/read-sites";
import { VoteSites } from "../../components/VoteSites";

export default async function VotePage() {
    // Each name in the reader's language, and the original where the admin wrote none.
    const sites = await readVoteSites(await getLocale());
    return <VoteSites initial={sites} />;
}
