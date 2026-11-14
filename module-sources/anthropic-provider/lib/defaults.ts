/**
 * What this provider uses until the operator says otherwise.
 *
 * One place, read by the settings screen to show the defaults and by the
 * handler to fall back on them, so the two cannot disagree. Every value is a
 * setting the operator can change; nothing here is the only possible answer.
 *
 * Effort defaults to low because the calls this serves are classifications
 * and short drafts, and on current Claude models thinking is on and spends
 * from the same `max_tokens` the answer needs. A model that takes no effort
 * (Haiku 4.5, say) needs it set to `auto`, which sends none.
 */
export const ANTHROPIC_DEFAULTS = {
    modelFast: "claude-haiku-5-5",
    modelSmart: "claude-sonnet-5-5",
    effort: "low",
} as const;

/**
 * The efforts the Messages API takes, and `auto`, which sends none and leaves
 * it to the model. Not an empty string: the settings form reads an empty
 * value as unset and would show the default in its place.
 */
export const ANTHROPIC_EFFORTS = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
