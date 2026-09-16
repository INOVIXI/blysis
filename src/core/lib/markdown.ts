/**
 * Markdown a person wrote, turned into HTML that is safe to render.
 *
 * Content used to be authored in a Quill toolbar and stored as the HTML Quill
 * happened to produce, which made the database hold the editor's output
 * format rather than what anybody typed. Markdown is the text itself: it
 * outlives the editor, it reads as itself in a database client, and it diffs.
 *
 * A useful HTML subset survives, because a page's front matter wants
 * `<div align="center">` and Markdown has no way to say it. That is why the
 * sanitiser rather than the parser is the boundary here - everything is
 * rendered first and then everything is cleaned, so a tag typed by hand and a
 * tag the parser built are held to the same list.
 *
 * Isomorphic on purpose: a server component renders an article and a client
 * component renders the editor's preview, and both must agree exactly, or the
 * preview is a promise the page does not keep.
 */
import DOMPurify from "isomorphic-dompurify";
import { Marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
import markedFootnote from "marked-footnote";
import markedAlert from "marked-alert";

/**
 * The parser, built once.
 *
 * Its own instance rather than the shared `marked` singleton: extensions are
 * registered globally on that one, and a module that imported `marked` for
 * something else would silently change how every page on the site renders.
 *
 * The three extensions are what GitHub renders and `marked` alone does not.
 * Footnotes are the reason this is not optional: without the extension
 * `text[^1]` came out as a link to a page called "note", which is wrong
 * rather than missing. Heading ids are what a `#link` inside a long document
 * points at. Alerts are the callouts a README opens with.
 */
const parser = new Marked()
    .use(gfmHeadingId())
    .use(markedFootnote())
    .use(markedAlert());

/**
 * What a writer may use.
 *
 * Everything Markdown itself can produce, plus the few layout tags a rich
 * page needs. Deliberately absent: `iframe`, `object`, `embed`, `form` and
 * anything that loads or submits on its own - a description is read, not run.
 */
const ALLOWED_TAGS = [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "del", "s", "u", "mark", "sub", "sup", "small",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "a", "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "div", "span", "center",
    "details", "summary",
    "picture", "source",
    // A keystroke, which every host renders and people type by hand.
    "kbd",
    // The tick box of a task list. Constrained below to a disabled checkbox:
    // `input` is the one tag here that could be a control, and a reader
    // ticking a box changes nothing anybody stored.
    "input",
    // The section a footnote lands in, and the arrow back up from it.
    "section", "sup",
];

/**
 * `align` and `width` are here because a badge row is built out of them and
 * Markdown cannot express either. No `style`: it is a whole language, and one
 * a writer can use to cover the page with.
 */
const ALLOWED_ATTR = [
    "href", "title", "target", "rel",
    "src", "srcset", "alt", "width", "height", "loading",
    "align", "colspan", "rowspan", "id", "class",
    // A list that starts at five starts at five. Without this the parser
    // built the attribute and the sanitiser threw it away.
    "start",
    // A task list's box, and the footnote machinery's own bookkeeping.
    "type", "checked", "disabled", "data-footnote-ref", "data-footnote-backref",
];

export interface MarkdownOptions {
    /**
     * Whether every line the writer ended is a line the reader sees.
     *
     * Off by default, which is the document rule and what Markdown means
     * everywhere it is written: the lines of a paragraph join, and a blank
     * line starts a new one. It matters most for the row of badges a project
     * page opens with - written one per line and meant to flow along one.
     * Forcing a break stacked nine of them down the page.
     *
     * On for text somebody typed into a plain box: a forum reply, a
     * suggestion, a comment. There is no preview there and no second chance,
     * so a post typed as three lines has to arrive as three lines. It is the
     * same distinction a code host makes between a README and a comment.
     */
    keepLineBreaks?: boolean;
}

/*
 * `input` is on the allowlist for one thing: the tick box of a task list.
 * Left at that, it also accepted `<input type="password">`, which on somebody
 * else's article is a prop for asking a reader for their password. The hook
 * keeps a checkbox, forces it read-only - a reader ticking a box changes
 * nothing anybody stored - and removes every other kind.
 *
 * Registered on the shared instance, which is safe because this file is the
 * only thing on the site that sanitises. Two gates hold that:
 * `one-component-renders-what-a-person-wrote` says no module imports a
 * sanitiser of its own, and `raw-html-reaches-a-page-only-through-a-decision`
 * says nothing writes HTML into a page without arguing for it first.
 */
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "input") return;
    const element = node as unknown as Element;
    if (element.getAttribute?.("type") !== "checkbox") {
        element.remove?.();
        return;
    }
    element.setAttribute?.("disabled", "");
});

/** Turn Markdown into HTML nobody has to trust. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
    if (!source?.trim()) return "";

    const html = parser.parse(source, {
        async: false,
        gfm: true,
        breaks: options.keepLineBreaks === true,
    });

    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        // DOMPurify lets every `data-*` through by default. A writer has no
        // use for one and a script on the page might: `data-controller` is a
        // handle for whatever framework is listening. The footnote
        // extension's own two are named in the list above and survive it.
        ALLOW_DATA_ATTR: false,
        // A link that runs something is not a link. DOMPurify refuses the
        // scheme rather than the attribute, so the href survives as text and
        // the page does not lose the sentence around it.
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
}
