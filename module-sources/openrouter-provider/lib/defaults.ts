/**
 * What this provider uses until the operator says otherwise.
 *
 * One place, read by the settings screen to show the defaults and by the
 * handler to fall back on them, so the two cannot disagree. Every value is a
 * setting the operator can change, and any model OpenRouter lists will do.
 *
 * Effort is left to the model: which efforts a model takes differs from one
 * model to the next.
 */
export const OPENROUTER_DEFAULTS = {
    modelFast: "openai/gpt-6-luna",
    modelSmart: "openai/gpt-6.1-sol",
    effort: "auto",
} as const;

/**
 * The reasoning efforts OpenRouter takes, and `auto`, which sends none. Not an
 * empty string: the settings form reads an empty value as unset and would
 * show the default in its place.
 */
export const OPENROUTER_EFFORTS = ["auto", "none", "minimal", "low", "medium", "high", "xhigh"] as const;
