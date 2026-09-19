/**
 * The rows a form is drawn in, worked out before anything is drawn.
 *
 * The crud shell handed every field to one `grid md:grid-cols-2` and let CSS
 * auto-placement decide the layout. That is fine while every field is the
 * same width and the same height, and neither is true:
 *
 *   - a field that needs the full width cannot fit in the one column left at
 *     the end of a row, so the browser moves it down and leaves that cell
 *     empty. On the new-announcement screen it is the gap beside Title;
 *   - a switch has no height of its own and was stretched to its neighbour's,
 *     which put it level with a text box's input rather than its label.
 *
 * Both are the same mistake: letting an accident of declaration order decide
 * what sits beside what. So the rows are decided here - one full-width field,
 * or up to two half-width ones, and a switch only ever beside another switch
 * - and a row holding one field is one column wide, so there is no cell left
 * to be empty.
 *
 * Order is preserved exactly. This function groups; it never sorts.
 */

/** What a field needs of a row. */
type Width = "full" | "half" | "switch";

/** One heading and the rows that stand under it. */
export interface Laid<T> {
    /** `undefined` for the fields declared before any heading. */
    group?: string;
    rows: T[][];
}

/**
 * Types that need the whole width: a box you write paragraphs in, a picture,
 * a file. A half-width one of these is a control nobody can use.
 */
const FULL_WIDTH = new Set(["textarea", "richtext", "image", "file"]);

function widthOf(type: string | undefined): Width {
    if (type === "toggle") return "switch";
    return type && FULL_WIDTH.has(type) ? "full" : "half";
}

/** Whether two widths may share a row. */
function pairs(a: Width, b: Width): boolean {
    if (a === "full" || b === "full") return false;
    // A switch beside a box is the alignment bug; a switch beside a switch is
    // two related answers to two related questions, which is the point.
    return a === b;
}

export function formSections<T>(
    fields: readonly T[],
    typeOf: (field: T) => string | undefined,
    groupOf: (field: T) => string | undefined = () => undefined,
): Laid<T>[] {
    const sections: Laid<T>[] = [];

    for (const field of fields) {
        const group = groupOf(field);
        const width = widthOf(typeOf(field));
        let section = sections[sections.length - 1];

        // A heading ends whatever row was open: nothing carries across it.
        if (!section || section.group !== group) {
            section = { group, rows: [] };
            sections.push(section);
        }

        const open = section.rows[section.rows.length - 1];
        if (open && open.length === 1 && pairs(widthOf(typeOf(open[0])), width)) {
            open.push(field);
        } else {
            section.rows.push([field]);
        }
    }

    return sections;
}
