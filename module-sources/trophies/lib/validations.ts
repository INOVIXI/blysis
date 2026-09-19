import { z } from "zod";

/**
 * Editing one trophy. The POST that creates trophies already validates; this
 * is the PATCH that did not, so `description`, `icon`, `color` and `awardOn`
 * reached the row as whatever arrived and at whatever length.
 */
export const trophyUpdateSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    icon: z.string().max(64).optional().nullable(),
    color: z.string().max(64).optional().nullable(),
    points: z.number().int().min(0).max(1_000_000).optional(),
    awardOn: z.string().max(128).optional().nullable(),
});

/**
 * One thing that has to have happened, and how many times.
 *
 * The rule used to be a single `ruleEvent` and `ruleThreshold`, typed into a
 * free text box: an operator had to know that `forum.topic.created` is a
 * string, spell it exactly, and know it is the one the engine counts. A
 * misspelling produced a trophy that could never be awarded to anybody, and
 * nothing on the screen said so - so the event is picked from the kinds the
 * site declares, and this is what one of them looks like once picked.
 */
export const trophyRuleSchema = z.object({
    event: z.string().min(1).max(128),
    threshold: z.number().int().min(1).max(1_000_000),
});

export type TrophyRule = z.infer<typeof trophyRuleSchema>;

/** Whether every condition has to be met, or any one of them. */
export const RULES_MODES = ["all", "any"] as const;

export type RulesMode = (typeof RULES_MODES)[number];

/**
 * What a trophy is actually waiting for, old shape or new.
 *
 * Every trophy in every database today is one `ruleEvent` and one
 * `ruleThreshold`, and the migration that adds the list deliberately copies
 * nothing across - writing the same rule in two places means keeping them in
 * step for ever. So the list wins where there is one, and the two old
 * columns are read as the list of one they already describe.
 */
export function trophyConditions(trophy: {
    rules?: unknown;
    ruleEvent?: string | null;
    ruleThreshold?: number | null;
}): TrophyRule[] {
    const parsed = z.array(trophyRuleSchema).safeParse(trophy.rules);
    if (parsed.success && parsed.data.length > 0) return parsed.data;
    if (trophy.ruleEvent) {
        return [{ event: trophy.ruleEvent, threshold: Math.max(1, trophy.ruleThreshold ?? 1) }];
    }
    return [];
}
