/**
 * What this provider uses until the operator says otherwise.
 *
 * One place, read by the settings screen to show the defaults and by the
 * handler to fall back on them, so the two cannot disagree. Every value is a
 * setting the operator can change.
 *
 * The models are the small and the mid tier of OpenAI's line as of this
 * module's release. Effort is left to the model: which efforts a model takes
 * differs from one model to the next, and one it does not take is refused.
 */
export const OPENAI_DEFAULTS = {
    modelFast: "gpt-6-luna",
    modelSmart: "gpt-6.1-sol",
    effort: "auto",
} as const;

/**
 * The reasoning efforts Chat Completions takes, and `auto`, which sends none.
 * Not an empty string: the settings form reads an empty value as unset and
 * would show the default in its place.
 */
export const OPENAI_EFFORTS = ["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
