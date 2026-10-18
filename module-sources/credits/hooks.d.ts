/**
 * The credit contract.
 *
 * Anything on this site can put credits into an account, and none of it should
 * write a balance itself: an increment without the ledger row beside it in the
 * same transaction leaves a balance nothing accounts for, which is what a
 * credit history exists to prevent. So there is one door, and it is a filter
 * rather than an action because the caller needs the answer - a job that
 * cannot tell "awarded" from "already awarded" from "refused" has no way to
 * decide whether to try again.
 *
 * There are two doors, for two shapes of the same rule. `credits.award` is a
 * grant that stands on its own and must happen once. `credit.change` is a
 * movement inside a transaction the caller already has open, which is what a
 * spin, a purchase or a transfer needs: the credits and the thing they paid
 * for commit together or not at all. Both are written by this module and
 * nothing else touches the balance or the ledger.
 */
import type { PrismaTransaction } from "@/core/sdk/server";

declare global {
    interface BlysisFilterPayloads {
        /** Whether the credits went in, and whether they had already. */
        "credits.award": CreditAwardOutcome;
        /** Whether the movement was made. */
        "credit.change": CreditMoved;
        /** A member's balance, or null when nothing keeps one. */
        "credits.balance": number | null;
        /** The members with the most credits, who bought the most, or who bought last. */
        "credits.top": CreditTopEntry[];
    }

    interface BlysisFilterContexts {
        "credits.award": CreditAwardRequest;
        "credit.change": CreditMovement;
        "credits.balance": { userId: string };
        /**
         * `balance` ranks what members hold now. `topups` ranks what they
         * bought in the period: `day`, `month`, `year` or `all`. `latest` lists
         * the newest top-ups in the period, newest first.
         */
        "credits.top": { kind: "balance" | "topups" | "latest"; period: "day" | "month" | "year" | "all"; limit: number };
    }

    interface CreditTopEntry {
        rank: number;
        userId: string;
        name: string;
        amount: number;
    }

    /**
     * A movement inside somebody else's transaction.
     *
     * `credits.award` is the door for a grant that stands on its own: a job
     * awards a bounty, and the ledger id derived from reason and key makes a
     * retry an award of nothing. This is the other half, and the reason four
     * modules went round both of them: a spin costs credits and produces a
     * prize, a purchase costs credits and delivers goods, and either both
     * happen or neither does. A door that opened its own transaction would
     * have turned each of those into two halves that can fail apart, so the
     * caller's transaction comes with the request and the movement joins it.
     */
    interface CreditMovement {
        tx: PrismaTransaction;
        /**
         * Null when no account holds it. The site issues this currency, so
         * its cut of a sale leaves circulation: there is a row to count and
         * no balance to move.
         */
        userId: string | null;
        /** Signed: negative spends, positive grants. */
        amount: number;
        /** A short machine-readable reason: `wheel_spin`, `market_sale`. */
        type: string;
        description?: string | null;
        /**
         * The id to write the ledger row under, for a caller holding a
         * deterministic one - a gateway's reference for the money. The
         * duplicate key is then what stops a retried webhook crediting twice,
         * and it aborts the caller's transaction with it.
         */
        ledgerId?: string;
    }

    interface CreditMoved {
        /**
         * False when the member did not have it, or when nothing answered.
         * A debit is always conditional on the balance covering it, so this
         * is how a caller learns it cannot go ahead.
         */
        applied: boolean;
    }

    interface CreditAwardRequest {
        userId: string;
        /** Whole credits, more than none. */
        amount: number;
        /**
         * What happened, in one word. It groups the history and it is half of
         * what makes the award happen once.
         */
        reason: string;
        /**
         * Which one it was, unique within the reason: an order id, a post id,
         * a date. The ledger row's id is derived from the pair, so a second
         * attempt is a duplicate key rather than a second award.
         */
        key: string;
        /** A sentence for the member's history. */
        description?: string;
    }

    interface CreditAwardOutcome {
        /** False when nothing answered, which means the module is not installed. */
        handled: boolean;
        /** True when this exact award had already been made. */
        duplicate: boolean;
        /** Why it was refused, or null when it was not. */
        error: string | null;
    }
}

export {};
