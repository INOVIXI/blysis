"use client";

import { useLocalDate } from "@/core/sdk/ui";

/**
 * The day a member joined, on the site's clock. A client component because
 * the site's time zone reaches the screen through `useLocalDate`, and without
 * it the server and the browser disagree about a date near midnight.
 */
export function JoinedOn({ date }: { date: Date | string }) {
    const formatDate = useLocalDate();
    return <>{formatDate(date)}</>;
}
