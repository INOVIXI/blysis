/**
 * The boards, read on the server.
 *
 * The page asked for the tabs, then asked again for the rows of the first one,
 * so the HTML the server sent carried no name and no rank: measured, 90
 * characters of text inside `<main>`.
 *
 * Modules answer this, not the module that draws it. The bus is filled by
 * core's catch-all before it renders a module page - see `ensureHooks` there -
 * so this does not fill it again: a filter nobody registered answers with the
 * value it was given and no error, which is what an empty board list in three
 * milliseconds looks like.
 */
import { applyFiltersAsync } from "@/core/sdk";

/*
 * The shape is the one the hook registry declares, not a second copy: a module
 * that answers `leaderboard.boards` is typed against that declaration, and a
 * looser one here would let a board through that the tabs cannot draw. That is
 * what a cast at the call site was hiding.
 */
export async function readBoards(boardId: string | null, limit = 20) {
    return applyFiltersAsync("leaderboard.boards", [], { boardId, limit });
}
