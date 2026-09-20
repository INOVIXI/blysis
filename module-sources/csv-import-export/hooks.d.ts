/**
 * Payload contract for the hook this module fires.
 *
 * The export screen used to draw three buttons - members, products, orders -
 * against an endpoint that only knew about members, so two of the three
 * answered a 400 in a new tab. It could not have done better on its own:
 * `Product` and `Order` belong to the shop, and a module reading another
 * module's tables is exactly the coupling the bus exists to avoid.
 *
 * So the question is asked. This module offers core's own table and whatever
 * is installed adds its own, the same way the shop answers an accounting
 * module's `store.orders.collect`.
 */

declare global {
    /** A cell as its own module holds it. The escaping is the exporter's job. */
    type CsvCell = string | number | boolean | Date | null;

    /** One thing this site can hand over as a table. */
    interface CsvExport {
        /**
         * Stable, and in the address of the download. Never shown to a
         * reader: `labelKey` is what a person sees.
         */
        id: string;
        /**
         * Where the name lives, namespace and all, because the words belong
         * to whichever module is offering the export rather than to this one.
         */
        labelKey: string;
        /** The first line of the file. */
        header: string[];
        /**
         * One page of rows, in an order that does not change between calls.
         *
         * An empty page ends the file, and a short one ends it after itself.
         * Rows are cells rather than text: the escaping, and with it the
         * guard that keeps a spreadsheet from running a cell as a command, is
         * done once by the module that writes the file.
         */
        read(skip: number, take: number): Promise<CsvCell[][]>;
    }

    interface BlysisFilterPayloads {
        /** Everything this site can export, each module adding its own. */
        "csv.exports": CsvExport[];
    }
}

export {};
