"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { slugify } from "@/core/sdk";

interface Section {
    id: string;
    text: string;
    level: 2 | 3;
}

/**
 * The article's sections, as links to them.
 *
 * Read from the article as drawn rather than from its markdown, because the
 * headings a reader sees are the ones `RichContent` produced, and given
 * addresses here: the renderer writes none, and a heading that already has
 * one keeps it. Read after the page has painted, so a reader without
 * scripting has the article and no list, which is what they had before.
 */
export function ArticleContents() {
    const t = useTranslations("blog");
    const [sections, setSections] = useState<Section[]>([]);

    useEffect(() => {
        const body = document.querySelector("[data-article-body]");
        if (!body) return;
        const taken = new Set<string>();
        const found = Array.from(body.querySelectorAll<HTMLElement>("h2, h3")).map((heading) => {
            const text = heading.textContent?.trim() ?? "";
            if (!heading.id) {
                const base = slugify(text) || "section";
                let id = base;
                for (let n = 2; taken.has(id) || document.getElementById(id); n++) id = `${base}-${n}`;
                heading.id = id;
            }
            taken.add(heading.id);
            return { id: heading.id, text, level: heading.tagName === "H3" ? 3 : 2 } satisfies Section;
        });
        setSections(found);
    }, []);

    if (sections.length < 2) return null;
    return (
        <nav aria-label={t("contents")} data-article-contents>
            <p className="text-sm font-semibold text-muted-foreground mb-2">{t("contents")}</p>
            <ol className="space-y-1 text-sm">
                {sections.map((section) => (
                    <li key={section.id} data-level={section.level} className={section.level === 3 ? "pl-3" : undefined}>
                        <a href={`#${section.id}`} className="text-foreground hover:text-primary transition-colors">{section.text}</a>
                    </li>
                ))}
            </ol>
        </nav>
    );
}
