/**
 * How a shop category names itself to a module that knows nothing about shops.
 *
 * One constant, used by the two hook handlers and by nothing else, because a
 * reference minted in one place and parsed in another by two hand-written
 * string literals is a reference that drifts on the day one of them is
 * edited.
 */
export const CATEGORY_SUBJECT = "store.category";

/** The category id inside a subject reference, or null when it is not ours. */
export function categoryIdIn(subjectRef: string): string | null {
    const prefix = `${CATEGORY_SUBJECT}:`;
    if (!subjectRef.startsWith(prefix)) return null;
    const id = subjectRef.slice(prefix.length).trim();
    return id === "" ? null : id;
}
