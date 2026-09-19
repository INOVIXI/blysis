"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
    Bold, Code, Eye, Heading1, Heading2, Heading3, Image as ImageIcon, Italic,
    Link as LinkIcon, List, ListOrdered, Quote, SquareCode, Strikethrough, Video,
} from "lucide-react";
import { cn } from "@/core/lib/utils";
import { renderMarkdown } from "@/core/lib/markdown";

interface RichTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    /**
     * The id of the element naming this editor, usually the `<Label>` above
     * it. The textarea takes the name directly now - a Quill contenteditable
     * could not, which is why four screens wrote a `<Label htmlFor>` that
     * named nothing.
     */
    labelledBy?: string;
    /**
     * How tall the writing area starts, as a CSS length.
     *
     * Three hundred pixels is right for an article and wrong for a sentence:
     * on the shelf form it stood in the middle of the page as though the
     * blurb were the point of the screen. A style rather than a class,
     * because a class assembled at runtime is a class Tailwind never sees.
     */
    minHeight?: string;
}

/**
 * The editor everything on this site is written in.
 *
 * It was a Quill toolbar, and what it stored was whatever HTML Quill produced
 * - so the database held the editor's output format rather than what anybody
 * typed, and a paragraph was a `<p>` because Quill said so. Markdown is the
 * text itself: it outlives the editor, it reads as itself in a database
 * client, and it diffs.
 *
 * The preview renders through `renderMarkdown`, the same function the page
 * uses, so what a writer is shown is what a reader will get. A preview drawn
 * by a second renderer is a promise the page does not keep.
 *
 * No editing surface of its own: it is a `<textarea>`, which already has
 * undo, spellcheck, selection, dictation, a caret that behaves, and a name
 * that a `<Label>` can point at. The buttons only wrap the selection.
 */
export function RichTextEditor({
    value,
    onChange,
    placeholder,
    className = "",
    labelledBy,
    minHeight = "300px",
}: RichTextEditorProps) {
    const t = useTranslations("common");
    const textareaId = useId();
    const textarea = useRef<HTMLTextAreaElement>(null);
    const [previewing, setPreviewing] = useState(false);

    /**
     * Put `before` and `after` around the selection, or around `sample` when
     * there is no selection, and leave the selection where a writer can carry
     * on typing inside what they just made.
     */
    const wrap = (before: string, after: string, sample: string) => {
        const field = textarea.current;
        if (!field) return;
        const { selectionStart: start, selectionEnd: end } = field;
        const selected = value.slice(start, end) || sample;
        const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
        onChange(next);
        // After React has written the new value, not before it.
        requestAnimationFrame(() => {
            field.focus();
            field.setSelectionRange(start + before.length, start + before.length + selected.length);
        });
    };

    /** A block marker belongs at the start of a line, never mid-sentence. */
    const prefixLine = (marker: string, sample: string) => {
        const field = textarea.current;
        if (!field) return;
        const { selectionStart: start, selectionEnd: end } = field;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const selected = value.slice(lineStart, end) || sample;
        const next = `${value.slice(0, lineStart)}${marker}${selected}${value.slice(end)}`;
        onChange(next);
        requestAnimationFrame(() => {
            field.focus();
            const caret = lineStart + marker.length + selected.length;
            field.setSelectionRange(caret, caret);
        });
    };

    const tools = [
        { key: "heading1", icon: Heading1, run: () => prefixLine("# ", t("headingSample")) },
        { key: "heading2", icon: Heading2, run: () => prefixLine("## ", t("headingSample")) },
        { key: "heading3", icon: Heading3, run: () => prefixLine("### ", t("headingSample")) },
        { key: "bold", icon: Bold, run: () => wrap("**", "**", t("boldSample")), divide: true },
        { key: "italic", icon: Italic, run: () => wrap("*", "*", t("italicSample")) },
        { key: "strikethrough", icon: Strikethrough, run: () => wrap("~~", "~~", t("strikethroughSample")) },
        { key: "inlineCode", icon: Code, run: () => wrap("`", "`", t("codeSample")) },
        { key: "codeBlock", icon: SquareCode, run: () => wrap("\n```\n", "\n```\n", t("codeSample")) },
        { key: "quote", icon: Quote, run: () => prefixLine("> ", t("quoteSample")), divide: true },
        { key: "bulletList", icon: List, run: () => prefixLine("- ", t("listItemSample")) },
        { key: "numberedList", icon: ListOrdered, run: () => prefixLine("1. ", t("listItemSample")) },
        { key: "link", icon: LinkIcon, run: () => wrap("[", "](https://)", t("linkSample")), divide: true },
        { key: "image", icon: ImageIcon, run: () => wrap("![", "](https://)", t("imageSample")) },
        { key: "video", icon: Video, run: () => wrap("[", "](https://)", t("videoSample")) },
    ];

    return (
        <div className={cn("rounded-md border border-border bg-background", className)}>
            <div
                className="flex flex-wrap items-center gap-1 border-b border-border bg-muted px-2 py-1.5"
                role="toolbar"
                aria-label={t("formatting")}
                aria-controls={textareaId}
            >
                {tools.map((tool) => (
                    <button
                        key={tool.key}
                        type="button"
                        title={t(tool.key)}
                        aria-label={t(tool.key)}
                        disabled={previewing}
                        onClick={tool.run}
                        className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
                            "transition-colors hover:bg-background hover:text-foreground",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                            "disabled:pointer-events-none disabled:opacity-40",
                            tool.divide && "ml-2 border-l border-border pl-2 w-10",
                        )}
                    >
                        <tool.icon className="h-4 w-4" aria-hidden="true" />
                    </button>
                ))}

                <button
                    type="button"
                    onClick={() => setPreviewing((on) => !on)}
                    aria-pressed={previewing}
                    className={cn(
                        "ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
                        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                        previewing
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    {t("preview")}
                </button>
            </div>

            {previewing ? (
                /* The same minimum height as the textarea, so turning the
                   preview on and off does not move the page under the writer. */
                <div className="blysis-content px-4 py-3" style={{ minHeight }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
            ) : (
                <textarea
                    id={textareaId}
                    ref={textarea}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder ?? t("writeContentHere")}
                    aria-labelledby={labelledBy}
                    spellCheck
                    style={{ minHeight }}
                    className={cn(
                        "w-full resize-y rounded-b-md bg-transparent px-4 py-3",
                        "font-mono text-sm leading-relaxed text-foreground",
                        // The ring is inset because the textarea fills the
                        // panel it sits in; drawn outside, it would be clipped
                        // by the border above it.
                        "placeholder:text-muted-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70",
                    )}
                />
            )}
        </div>
    );
}
