import { z } from "zod";

/**
 * The day a release shipped, which the timeline is dated and ordered by.
 *
 * An admin may set it when a release is written up after the fact, so the
 * timeline reads in the order things happened. It may not be in the future:
 * a release that is not out yet is held back with `publishAt`, and a future
 * date here would show a release as shipped on a day that has not come.
 */
export const RELEASED_ON = z.string().datetime().refine(
    (value) => new Date(value).getTime() <= Date.now(),
    "A release cannot have shipped in the future",
);
