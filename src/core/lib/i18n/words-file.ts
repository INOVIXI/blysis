import { z } from "zod";
import { MAX_MESSAGE_LENGTH } from "@/core/lib/message-edit";
import { locales } from "./config";

/**
 * The file a site's own words travel in, from one install to another.
 *
 * Only what the site wrote: every other string ships with the software and
 * the modules, and arrives with them. Each entry names the string and the
 * language, and holds what the site says there. The format is versioned so a
 * later one can be told apart rather than misread.
 */

export const WORDS_FILE_FORMAT = "site-words";

/** More edits than a site makes by hand, and what one request can carry. */
export const MAX_FILE_STRINGS = 2000;

const entrySchema = z.object({
    namespace: z.string().min(1).max(120),
    key: z.string().min(1).max(300),
    locale: z.enum(locales),
    // One past the limit, so an over-long string is refused by the check a
    // hand edit gets, by name, rather than the whole file by its schema.
    value: z.string().max(MAX_MESSAGE_LENGTH + 1),
});

export const wordsFileSchema = z.object({
    format: z.literal(WORDS_FILE_FORMAT),
    version: z.literal(1),
    strings: z.array(entrySchema).max(MAX_FILE_STRINGS),
});

export type WordsEntry = z.infer<typeof entrySchema>;
