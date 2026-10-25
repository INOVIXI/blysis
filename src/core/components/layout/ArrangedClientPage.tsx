"use client";

import React from "react";
import { PageFrame } from "@/core/components/layout/PageFrame";
import { PageRows } from "@/core/components/layout/arranged-rows";
import { usePageLayout } from "@/core/hooks/usePageLayout";
import type { ArrangedPageProps } from "@/core/components/layout/ArrangedPage";

export type ArrangedClientPageProps = ArrangedPageProps;

/**
 * `ArrangedPage` for a page drawn in the browser: a ticket, the cart, the
 * wheel read what they show after they arrive, so the server cannot draw
 * them. The arrangement is the active theme's, resolved and drawn as the
 * server does it, so a page stands the same whichever side draws it.
 */
export function ArrangedClientPage({ page, frame, blocks, children, sidebar = true }: ArrangedClientPageProps) {
    const layout = usePageLayout(page);
    return (
        <PageFrame {...frame} header={layout?.header ?? "shown"}>
            {children}
            <PageRows rows={layout?.rows ?? []} draw={blocks} sidebar={sidebar} />
        </PageFrame>
    );
}
