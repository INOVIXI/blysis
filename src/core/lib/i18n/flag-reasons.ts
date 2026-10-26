/**
 * Why a string in one language wants the operator's eye.
 *
 * `review`: an update shipped a new original under the site's edit, so the
 * edit stands in for words that are no longer the ones it replaced.
 * `translate`: the string changed in another language after this one was
 * written. Written by the editor and by `scripts/seed-translations.ts`, which
 * cannot reach the app's database client, so the names live apart from both.
 */
export const FLAG_REVIEW = "review";
export const FLAG_TRANSLATE = "translate";

export type FlagReason = typeof FLAG_REVIEW | typeof FLAG_TRANSLATE;
