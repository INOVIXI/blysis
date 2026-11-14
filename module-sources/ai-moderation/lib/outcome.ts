/**
 * What a review row shows as its outcome: what the reviewer answered, or that
 * it could not answer. A failed call is answered "leave" too, but an admin
 * reads it as a different thing: the model was not asked, not unsure.
 */
export type Outcome = "approve" | "reject" | "leave" | "error";

export function outcomeOf(review: { verdict: string; applied: string }): Outcome {
    if (review.verdict === "error") return "error";
    return review.applied === "approve" || review.applied === "reject" ? review.applied : "leave";
}

const TONE = { approve: "success", reject: "danger", leave: "warning", error: "neutral" } as const;

export function outcomeTone(outcome: Outcome): (typeof TONE)[Outcome] {
    return TONE[outcome];
}
