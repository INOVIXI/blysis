/** Minutes to read, at two hundred words a minute, never less than one. */
export function readingMinutes(content: string | null | undefined): number {
    const words = (content ?? "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
}
