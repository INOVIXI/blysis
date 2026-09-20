/**
 * Every account a member has proved is theirs.
 *
 * One reader for both screens: the member's own tab and the public profile.
 * They used to query `LinkedAccount` separately, so a link could be shown in
 * one and not the other, and neither of them had asked anybody whether it was
 * true.
 */
import { applyFiltersAsync } from "@/core/sdk";
import type { LinkedAccountSummary } from "../hooks.d";

export async function readLinkedAccounts(userId: string): Promise<LinkedAccountSummary[]> {
    return applyFiltersAsync("profile.linkedAccounts", [], { userId });
}
