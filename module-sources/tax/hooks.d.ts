/**
 * Payload contract for the hook this module fires. See blog/hooks.d.ts for
 * why the emitter owns these shapes.
 */
declare global {
    interface BlysisFilters {
        /**
         * The country an address is in, as ISO 3166-1 alpha-2, or null.
         *
         * Asked for a buyer's connection when no CDN header the operator
         * trusts has said. Nothing answers it here: looking an address up
         * means a database or a paid service, and that is a module the
         * operator chooses to install, never a call made by default.
         */
        "geo.country": string | null;
    }

    interface BlysisFilterContexts {
        "geo.country": { ip: string };
    }
}

export {};
