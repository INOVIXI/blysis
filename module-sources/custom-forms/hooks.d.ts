/**
 * Payload contract for the hooks this module fires. See blog/hooks.d.ts for
 * why the emitter owns these shapes and what widening/narrowing means.
 */
declare global {
    interface BlysisHookPayloads {
        // Fired when an operator moves a submission to another state, the
        // inbox steps included, so a listener reads `status` to tell an
        // approval or a rejection from a row being marked read.
        "customforms.submission.reviewed": {
            formId: string;
            submissionId: string;
            // Null for a submission sent without signing in: there is
            // nobody to tell about the decision.
            userId: string | null;
            status: "new" | "read" | "handled" | "approved" | "rejected";
            previousStatus: string;
        };
    }
}

export {};
