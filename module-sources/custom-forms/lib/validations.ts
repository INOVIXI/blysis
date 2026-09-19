import { z } from "zod";

/**
 * A form's field list, and what a visitor may submit against it.
 *
 * Both used to reach Prisma untouched. `fields` is a Json column, so any
 * shape at all was storable, including one the public renderer cannot read -
 * a form saved with a non-array `fields` renders as a blank page with no
 * error. And a submission's `data` was accepted as literally anything that
 * was not falsy: a 900 KB string, a nested object, an array.
 */
/**
 * The kinds of question a form can ask.
 *
 * Six of these existed and none of them could be set up. Picking "select"
 * changed a string in the stored JSON and nothing else - there was nowhere to
 * type the options - so the public form drew a dropdown with one empty entry
 * in it, which a visitor cannot answer and, if the field was required, cannot
 * get past. From the operator's chair the type had simply not changed.
 *
 * `file` is deliberately not here. An upload needs somewhere to put the file
 * and a rule about who may read it back, and this module has neither; naming
 * a type nobody can choose is a promise the screen does not keep, which is
 * why the string for it went too.
 */
export const FIELD_TYPES = [
    "text", "email", "url", "tel", "number", "date",
    "textarea", "select", "radio", "checkbox",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * What a type needs before the question it asks makes sense.
 *
 * Written down once, because three places have to agree about it: the builder
 * decides which boxes to show, the schema decides what to refuse, and the
 * public form decides what to pass to the control. They used to agree by
 * coincidence, and a tick box's caption - which the public form reads out of
 * `placeholder` - was a box the builder never showed at all.
 */
export interface FieldNeeds {
    /** A list of answers to choose between. Without one the field is dead. */
    options: boolean;
    /** Ghost text inside the box, or the sentence beside a tick. */
    placeholder: boolean;
    /** A smallest and largest value. */
    range: boolean;
    /** A ceiling on how much can be typed. */
    length: boolean;
}

export function fieldNeeds(type: string): FieldNeeds {
    return {
        options: type === "select" || type === "radio",
        placeholder: type !== "select" && type !== "radio" && type !== "date",
        range: type === "number" || type === "date",
        length: type === "text" || type === "textarea",
    };
}

/**
 * A name no other field on the form is using.
 *
 * `data` is keyed by a field's name, so two fields called the same thing
 * means one person's answer silently overwrites the other's - and the name
 * used to be made by lowercasing the label, so two questions worded the same
 * way collided without anybody being told. The label is still where a name
 * comes from, because a readable key is worth having when somebody reads the
 * stored answers; it is the collision that is new.
 */
export function uniqueName(label: string, taken: readonly string[]): string {
    const base = label
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
        .replace(/^_+|_+$/g, "")
        .slice(0, 56) || "field";
    if (!taken.includes(base)) return base;
    for (let n = 2; n < 1000; n++) {
        const candidate = `${base}_${n}`;
        if (!taken.includes(candidate)) return candidate;
    }
    return `${base}_${Date.now()}`;
}

export const formFieldSchema = z.object({
    name: z.string().min(1).max(64),
    type: z.enum(FIELD_TYPES),
    label: z.string().min(1).max(200),
    required: z.boolean(),
    /** A line under the label saying how to answer. */
    help: z.string().max(500).optional(),
    placeholder: z.string().max(200).optional(),
    options: z.array(z.string().min(1).max(200)).max(100).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    maxLength: z.number().int().min(1).max(10_000).optional(),
}).strict().superRefine((field, ctx) => {
    // A choice field with nothing to choose is the bug this whole change is
    // about. Refusing it here is what stops it reaching a visitor.
    if (fieldNeeds(field.type).options && !(field.options && field.options.length > 0)) {
        ctx.addIssue({
            code: "custom",
            path: ["options"],
            message: `"${field.label}" is a ${field.type} with no options to choose from`,
        });
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        ctx.addIssue({ code: "custom", path: ["max"], message: "max must not be below min" });
    }
});

/** No two fields may answer to the same key; see `uniqueName`. */
const fieldList = z.array(formFieldSchema).min(1, "Title and fields required").max(100)
    .superRefine((fields, ctx) => {
        const seen = new Set<string>();
        for (const [index, field] of fields.entries()) {
            if (seen.has(field.name)) {
                ctx.addIssue({
                    code: "custom",
                    path: [index, "name"],
                    message: `two fields answer to "${field.name}", so one answer would overwrite the other`,
                });
            }
            seen.add(field.name);
        }
    });

export const formCreateSchema = z.object({
    title: z.string().trim().min(1, "Title and fields required").max(200),
    description: z.string().max(1_000).optional().nullable(),
    fields: fieldList,
});

export const formUpdateSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(1_000).optional().nullable(),
    fields: fieldList.optional(),
    isActive: z.boolean().optional(),
});

/**
 * A submission answers each field by name. The renderer only ever produces
 * strings (a checkbox becomes "true"/"false"), so that is what is accepted;
 * the ceilings are per-answer rather than only on the whole body, so one
 * field cannot carry the entire 1 MiB the body cap allows.
 */
export const formSubmissionSchema = z.object({
    data: z.record(z.string().max(64), z.string().max(10_000)),
});

/**
 * Where a submission can be in an operator's day.
 *
 * The column has held one of these three since the module was written and
 * nothing in it ever wrote the column, so the value a row was created with
 * was the value it kept. A list that only grows is not an inbox; these are
 * what an operator moves a row between, and the list is closed so the screen
 * can name every one of them.
 */
export const SUBMISSION_STATES = ["new", "read", "handled"] as const;

export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export const submissionUpdateSchema = z.object({
    status: z.enum(SUBMISSION_STATES),
});

/**
 * Whether what arrived answers the questions that were asked.
 *
 * The submit endpoint accepted any keys at all, so a submission could carry
 * fields the form never had - and the admin screen draws every key it is
 * given, so those appear as answers with no question above them. A required
 * field could be left out, because the only thing asking for it was the
 * browser's own `required`; a dropdown's answer did not have to be one of its
 * own choices; and a length limit set in the builder was a limit only for
 * somebody using the page as intended.
 *
 * The form is already read out of the database before the submission is
 * written, so this costs nothing but the comparison.
 *
 * Returns the first thing wrong, as a reason the caller turns into a sentence
 * in the visitor's language. A code rather than a message, because this file
 * is not where the site's words live.
 */
export type AnswerProblem =
    | { reason: "unknown_field"; field: string }
    | { reason: "missing_required"; field: string; label: string }
    | { reason: "not_an_option"; field: string; label: string }
    | { reason: "too_long"; field: string; label: string; limit: number };

/**
 * The questions as they are stored, read leniently.
 *
 * `fields` is a Json column, so what comes back has no type. Reading it with
 * `formFieldSchema` would be the obvious thing and is the wrong one: that
 * schema refuses a dropdown with no choices, and forms saved before the
 * builder could give it any are sitting in the database exactly like that.
 *
 * So this takes only what the check below needs and lets the rest through. A
 * shape it cannot read at all yields nothing, and the caller then stores the
 * submission unchecked rather than refusing it - a visitor should not lose
 * what they wrote because we cannot read our own column.
 */
export const storedFieldsSchema = z.array(
    z.object({
        name: z.string(),
        type: z.string(),
        label: z.string().default(""),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional(),
        maxLength: z.number().optional(),
    }).loose(),
);

export function checkAnswers(
    fields: readonly { name: string; type: string; label: string; required: boolean; options?: string[]; maxLength?: number }[],
    answers: Record<string, string>,
): AnswerProblem | null {
    const byName = new Map(fields.map((field) => [field.name, field]));

    for (const name of Object.keys(answers)) {
        if (!byName.has(name)) return { reason: "unknown_field", field: name };
    }

    for (const field of fields) {
        const given = answers[field.name];
        // A tick box that was not ticked arrives as "false", which is an
        // answer; an empty string is the absence of one.
        const answered = given !== undefined && given.trim() !== "";

        if (field.required && !answered) {
            if (field.type === "checkbox" && given === "false") {
                return { reason: "missing_required", field: field.name, label: field.label };
            }
            if (!answered) return { reason: "missing_required", field: field.name, label: field.label };
        }
        if (!answered) continue;

        if (fieldNeeds(field.type).options && !(field.options ?? []).includes(given)) {
            return { reason: "not_an_option", field: field.name, label: field.label };
        }
        if (field.maxLength !== undefined && given.length > field.maxLength) {
            return { reason: "too_long", field: field.name, label: field.label, limit: field.maxLength };
        }
    }

    return null;
}
