/**
 * Payload contract for the hooks this module fires. See blog/hooks.d.ts for
 * why the emitter owns these shapes.
 */
declare global {
    interface BlysisHookPayloads {
        /** A member opened a crate and was handed what came out of it. */
        "crates.opened": {
            userId: string;
            crateId: string;
            openingId: string;
            rewardId: string;
            rewardName: string;
            /** credits | product | nothing */
            rewardKind: string;
            rewardValue: number;
            /** key | credits */
            paidWith: string;
        };
    }
}

export {};
