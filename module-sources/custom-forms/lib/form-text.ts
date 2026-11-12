import { translateContent, type ContentTranslations } from "@/core/sdk/server";

/**
 * A form's words in the reader's language.
 *
 * The title and the description are columns; everything a question says is
 * inside the `fields` JSON. Both keep the original exactly as the admin typed
 * it, and every translation is a row of core's `ContentTranslation` table
 * owned by the form, named by what it translates: `title`, `description`,
 * `field.<name>.label`, `.help`, `.placeholder` (a tick box's caption) and
 * `field.<name>.option.<choice>`.
 *
 * A choice is named by its original wording, not its position, because the
 * original is also what a visitor's answer is: it is submitted, checked
 * against the choices and stored in that wording whatever language the form
 * was read in, so an operator reads every answer the same way. A reader is
 * handed the choices as they are and `optionLabels` beside them.
 * `a-form-is-read-in-the-readers-language` holds the behaviour.
 */

export const FORM_TEXT = { owner: "custom-forms", entity: "form" };

/** The questions as far as their words go; the JSON column has no type. */
interface Question {
    name: string;
    label?: unknown;
    help?: unknown;
    placeholder?: unknown;
    options?: unknown;
}

function questionsOf(fields: unknown): Question[] {
    if (!Array.isArray(fields)) return [];
    return fields.filter((field): field is Question =>
        typeof field === "object" && field !== null && typeof (field as { name?: unknown }).name === "string");
}

/** Each translatable text of a form and its original, under the key it is stored by. */
function originalsOf(form: { title: string; description: string | null; fields: unknown }): Record<string, string> {
    const out: Record<string, string> = { title: form.title };
    if (form.description) out.description = form.description;
    for (const question of questionsOf(form.fields)) {
        const key = `field.${question.name}`;
        if (typeof question.label === "string") out[`${key}.label`] = question.label;
        if (typeof question.help === "string" && question.help !== "") out[`${key}.help`] = question.help;
        if (typeof question.placeholder === "string" && question.placeholder !== "") out[`${key}.placeholder`] = question.placeholder;
        if (Array.isArray(question.options)) {
            for (const option of question.options) {
                if (typeof option === "string") out[`${key}.option.${option}`] = option;
            }
        }
    }
    return out;
}

/**
 * What may be translated in a form with these questions, each held to the
 * limit its original is held to. A translation the definition has no place
 * for is refused, as a column a module does not translate is.
 */
export function formTextLimits(fields: unknown): Record<string, number> {
    const limits: Record<string, number> = { title: 200, description: 1_000 };
    for (const question of questionsOf(fields)) {
        const key = `field.${question.name}`;
        limits[`${key}.label`] = 200;
        limits[`${key}.help`] = 500;
        limits[`${key}.placeholder`] = 200;
        if (Array.isArray(question.options)) {
            for (const option of question.options) {
                if (typeof option === "string") limits[`${key}.option.${option}`] = 200;
            }
        }
    }
    return limits;
}

/**
 * The translations to save: what the form sent, and an empty entry for every
 * stored translation whose question or choice is gone. A question is named by
 * its label, so a label rewritten renames it, and its old words would
 * otherwise outlive it.
 */
export function withStaleCleared(
    sent: ContentTranslations | undefined,
    stored: ContentTranslations | undefined,
    limits: Record<string, number>,
): ContentTranslations {
    const out: ContentTranslations = { ...(sent ?? {}) };
    for (const key of Object.keys(stored ?? {})) {
        if (!(key in limits) && !(key in out)) out[key] = {};
    }
    return out;
}

/**
 * A form as a reader of `locale` is shown it: one query for every word on
 * it, the reader's translation where it holds anything but blanks and the
 * original otherwise.
 */
export async function translateForm<T extends { id: string; title: string; description: string | null; fields: unknown }>(
    db: Parameters<typeof translateContent>[0],
    form: T,
    locale: string,
): Promise<T & { fields: unknown }> {
    const originals = originalsOf(form);
    // One row of every word, so the whole form is one query.
    const row: Record<string, string> & { id: string } = { ...originals, id: form.id };
    const [words] = await translateContent(db, FORM_TEXT, [row], Object.keys(originals), locale);
    if (!Array.isArray(form.fields)) return { ...form, title: words.title, description: form.description ? words.description : form.description };
    const fields = form.fields.map((field: unknown) => {
        if (typeof field !== "object" || field === null || typeof (field as Question).name !== "string") return field;
        const question = field as Question & Record<string, unknown>;
        const key = `field.${question.name}`;
        const out: Record<string, unknown> = { ...question };
        if (`${key}.label` in words) out.label = words[`${key}.label`];
        if (`${key}.help` in words) out.help = words[`${key}.help`];
        if (`${key}.placeholder` in words) out.placeholder = words[`${key}.placeholder`];
        if (Array.isArray(question.options)) {
            out.optionLabels = question.options.map((option) =>
                typeof option === "string" ? words[`${key}.option.${option}`] ?? option : option);
        }
        return out;
    });
    return { ...form, title: words.title, description: form.description ? words.description : form.description, fields };
}
