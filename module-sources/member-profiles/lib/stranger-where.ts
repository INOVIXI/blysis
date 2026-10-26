/**
 * Which rows of one kind a member's public profile may show: counted, listed
 * and named alike, so a profile that says "2 topics" opens a list of two.
 *
 * The kind's own rule in `member-content.ts` first, then whatever the module
 * that owns the rows narrows it to through `profile.contentWhere`, since only
 * it knows its sections, its permissions and whether it is open to visitors.
 * Null when a stranger may read none of it.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { CONTENT_KINDS } from "./member-content";

export async function strangerWhere(kind: string): Promise<Record<string, unknown> | null> {
    const own = CONTENT_KINDS.find((k) => k.kind === kind)?.where ?? {};
    return applyFiltersAsync("profile.contentWhere", own, { kind });
}
