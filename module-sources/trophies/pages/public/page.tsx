/**
 * The trophies, written by the server.
 *
 * The grid below stays a client component because which trophies a reader has
 * earned is that reader's own answer, but the list itself used to be fetched
 * on mount too - so the HTML the server sent carried no trophy and no
 * description: measured, 75 characters of text inside `<main>`.
 */
import { readTrophies } from "../../lib/read-trophies";
import { TrophyGrid } from "../../components/TrophyGrid";

export default async function PublicTrophiesPage() {
    const trophies = await readTrophies();
    return <TrophyGrid initial={trophies} />;
}
