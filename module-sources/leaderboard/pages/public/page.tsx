/**
 * The boards, written by the server.
 *
 * The tabs below stay a client component because switching one asks for
 * another board's rows, but the page used to fetch both the tab list and the
 * first board on mount - so the HTML the server sent carried no name and no
 * rank: measured, 90 characters of text inside `<main>`.
 */
import { readBoards } from "../../lib/read-boards";
import { BoardTabs } from "../../components/BoardTabs";

export default async function LeaderboardPage() {
    // Once with no board named, so a module answers with its heading rather
    // than with a query, and once for the board that will be open.
    const boards = await readBoards(null);
    const first = boards[0]?.id ?? null;
    const opened = first ? await readBoards(first, 20) : [];
    const rows = opened.find((board) => board.id === first)?.rows ?? [];

    return <BoardTabs initialBoards={boards} initialRows={rows} initialId={first} />;
}
