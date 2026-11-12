/**
 * A submission's state as the person who sent it reads it.
 *
 * `new` and `read` are where it sits in an operator's inbox, which is the
 * operator's business: to the member both are "waiting for an answer". The
 * rest are told as they are.
 */
export const MEMBER_STATUSES = ["pending", "handled", "approved", "rejected"] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export function memberStatus(status: string): MemberStatus {
    if (status === "approved" || status === "rejected" || status === "handled") return status;
    return "pending";
}
