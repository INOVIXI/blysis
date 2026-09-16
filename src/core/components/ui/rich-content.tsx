import { cn } from "@/core/lib/utils";
import { renderMarkdown } from "@/core/lib/markdown";

/**
 * Markdown a person wrote, rendered safely and styled like the rest of the
 * site.
 *
 * Seven module screens each imported DOMPurify, each called `sanitize` with
 * its own defaults, and each rendered the result through `prose
 * dark:prose-invert` - class names that match nothing, because this project
 * has no typography plugin. So the writing on the blog, the forum, the help
 * centre, the changelog, custom pages and every product description came out
 * with body-sized headings and unmarked lists.
 *
 * Six of the seven also imported plain `dompurify`, which needs a window. In
 * a client component that renders on the server before its data arrives that
 * happens to survive, because the content is empty on the first pass. It is
 * not a property to rely on. This uses the isomorphic build, which brings its
 * own DOM on the server.
 *
 * One component means one sanitiser configuration to reason about, rather
 * than seven that can drift apart, and the next module gets both the safety
 * and the styling by importing it.
 *
 * It takes Markdown now rather than HTML. What was stored before was whatever
 * the Quill toolbar produced, so the database held the editor's output format
 * and the writing could not outlive the editor. The tags this ends up
 * rendering are the same ones `blysis-content` already dresses, so nothing
 * about how a page looks moved with it.
 */
export function RichContent({
    markdown,
    className,
    as: Tag = "div",
    keepLineBreaks = false,
}: {
    markdown: string;
    className?: string;
    /** A forum post sits inside an article; a description does not. */
    as?: "div" | "article" | "section";
    /**
     * Set where the text was typed into a plain box rather than written in
     * the editor - a forum reply, a suggestion, a comment. See
     * `MarkdownOptions`: a document joins the lines of a paragraph, and a
     * reply cannot, because nobody previewed it.
     */
    keepLineBreaks?: boolean;
}) {
    return (
        <Tag
            className={cn("blysis-content", className)}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown, { keepLineBreaks }) }}
        />
    );
}
