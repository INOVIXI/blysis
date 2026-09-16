/**
 * The suggestion board, written by the server.
 *
 * The board below stays a client component - voting, the form and the filters
 * are its job - but it used to fetch the suggestions on mount, so the HTML the
 * server sent held no suggestion, no title and no link to one: measured, 165
 * characters of text inside `<main>`.
 *
 * `readSuggestions` decides what a reader may see, and the endpoint calls it
 * too: everyone gets the public, approved ones and an administrator gets the
 * rest, on both.
 */
import { readSuggestions } from "../../lib/read-suggestions";
import { SuggestionBoard } from "../../components/SuggestionBoard";

export default async function SuggestionsPage() {
    const read = await readSuggestions({ sort: "newest", page: 1 });
    return <SuggestionBoard initial={read.suggestions as unknown as { id: string }[]} />;
}
