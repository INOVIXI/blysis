"use client";

import React from "react";
import { ModuleSlotContents } from "@/core/generated/module-registry";
import { SlotContentRegistry } from "@/core/generated/module-components";
import { useAllModules } from "@/core/providers/module-provider";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { isEnabledIn } from "@/core/lib/module-enabled";

/**
 * Named slot - any module's template can declare a <Slot name="xxx"> and
 * other modules can inject content into it via their manifest.slotContents.
 *
 * Example:
 *   // In blog article page template:
 *   <article>
 *     <h1>{article.title}</h1>
 *     <Slot name="blog.article.aboveContent" context={{ articleId: article.id }} />
 *     <RichContent markdown={article.content} />
 *     <Slot name="blog.article.belowContent" context={{ articleId: article.id }} />
 *   </article>
 *
 *   // In another module's manifest.json:
 *   "slotContents": [
 *     { "slot": "blog.article.belowContent", "component": "components/RelatedProducts", "order": 10 }
 *   ]
 *
 * This is the template-extension pattern: modules contribute output into
 * another module's render tree without either side knowing about the other.
 * Slot consumers don't know who injects; injectors don't know who exposes.
 *
 * Naming convention: `<module>.<view>.<position>`
 *   blog.article.aboveContent
 *   blog.article.belowContent
 *   store.product.aboveDescription
 *   forum.topic.belowFirstPost
 *   homepage.hero
 *   homepage.belowHero
 */

interface SlotProps {
    name: string;
    context?: Record<string, unknown>;
    /**
     * Render this if no modules contribute to the slot, and hand it to the
     * contribution when there is exactly one.
     *
     * The second half is what makes a fallback honest. Whether anybody
     * contributes is a question about the registry, answered before a single
     * component runs; whether the contribution has anything to say is only
     * known once it has asked. A module that filled `store.category.shelf`
     * and then rendered nothing - no comparison table bound to that shelf -
     * left the shop's whole shelf blank, because the shop had handed the
     * region over and the fallback had already decided not to fire.
     *
     * Only when there is one contribution. A region two modules both claim
     * has no single answer to "is it empty", and drawing the fallback beside
     * a contribution that did render would double the page.
     */
    fallback?: React.ReactNode;
}

export function Slot({ name, context, fallback = null }: SlotProps) {
    const moduleStatus = useAllModules();

    const contributions = ModuleSlotContents
        .filter((sc) => sc.slot === name)
        .filter((sc) => isEnabledIn(moduleStatus, sc.module))
        .filter((sc) => (SlotContentRegistry as Record<string, React.ComponentType<Record<string, unknown>>>)[sc.id])
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    if (contributions.length === 0) return <>{fallback}</>;

    return (
        <>
            {contributions.map((sc) => {
                const Component = (SlotContentRegistry as Record<string, React.ComponentType<Record<string, unknown>>>)[sc.id];
                return (
                    <ModuleErrorBoundary key={sc.id} componentId={sc.id}>
                        <Component
                            {...(context || {})}
                            {...(contributions.length === 1 ? { fallback } : {})}
                        />
                    </ModuleErrorBoundary>
                );
            })}
        </>
    );
}
