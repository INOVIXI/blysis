/**
 * Payload contract for the hooks this module fires. See blog/hooks.d.ts for
 * why the emitter owns these shapes and what widening/narrowing means.
 *
 * Both are asked of whatever can help answer a ticket. A source answers
 * `support.sources` with its id and name, so the settings screen can offer
 * it, and `support.knowledge` with what it holds that shares the most words
 * with the ticket, only when its id is among `sources`.
 */
import type { KnowledgePiece, KnowledgeQuestion, KnowledgeSource } from "./lib/desk";

declare global {
    interface BlysisFilterPayloads {
        "support.knowledge": KnowledgePiece[];
        "support.sources": KnowledgeSource[];
    }

    interface BlysisFilterContexts {
        "support.knowledge": KnowledgeQuestion;
        "support.sources": { locale: string };
    }
}

export {};
