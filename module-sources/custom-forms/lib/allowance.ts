import type { prisma } from "@/core/sdk/server";

/**
 * How many times a member has sent a form in its current period.
 *
 * A submission counts only if it was made at or after `limitPeriodStart`;
 * null means every submission counts. Resetting the allowances moves that
 * start, so what was sent before it stays, with its decision, and stops
 * counting.
 */

type Db = Pick<typeof prisma, "customFormSubmission">;

interface LimitedForm {
    id: string;
    limitPeriodStart: Date | null;
}

/** The submissions that count in this form's current period. */
export function periodWhere(form: LimitedForm): { formId: string; createdAt?: { gte: Date } } {
    return form.limitPeriodStart
        ? { formId: form.id, createdAt: { gte: form.limitPeriodStart } }
        : { formId: form.id };
}

export function usedAllowance(db: Db, form: LimitedForm, userId: string): Promise<number> {
    return db.customFormSubmission.count({ where: { ...periodWhere(form), userId } });
}
