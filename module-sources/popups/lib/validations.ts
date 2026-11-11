import { z } from "zod";

/**
 * A popup is written from two places - POST /api/v1/popups creates one and
 * PATCH /api/v1/popups/[id] edits one - and both land in the same row. When
 * only one of them validates, the bounds are not bounds at all: whatever the
 * create path refuses can still be PATCHed in afterwards, and whatever the
 * edit path refuses can be created directly. Both handlers parse the schemas
 * below so the two doors agree on what a popup is allowed to contain.
 *
 * The admin form submits every field on every save, so a field the admin
 * cleared arrives as an empty string. That means "no value", not "the empty
 * string" - an empty date in particular would otherwise coerce to an Invalid
 * Date and fail the parse, rejecting a perfectly ordinary save.
 */
const optionalText = (max: number) =>
    z.preprocess((v) => (v === "" ? null : v), z.string().max(max).nullable().optional());

const optionalDate = z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional());

export const popupSchema = z.object({
    title: z.string().min(1, "Title is required").max(200),
    content: optionalText(20000),
    image: optionalText(2000),
    link: optionalText(2000),
    linkText: optionalText(100),
    isActive: z.boolean().optional(),
    startsAt: optionalDate,
    endsAt: optionalDate,
});

export const popupUpdateSchema = popupSchema.partial();

/**
 * Whose translations these are, in core's table, and the fields that have
 * them: each language held to its column's own limit. The link is an
 * address, the same in every language.
 */
export const POPUP_TEXT = { owner: "popups", entity: "popup" };
export const TRANSLATED_FIELDS = { title: 200, content: 20000, linkText: 100 };

export type PopupInput = z.infer<typeof popupSchema>;
