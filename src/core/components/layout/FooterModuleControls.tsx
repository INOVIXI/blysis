"use client";

import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { FooterComponentRegistry } from "@/core/generated/module-components";
import { ModuleFooterComponents } from "@/core/generated/module-registry";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { useAllModules } from "@/core/providers/module-provider";

/**
 * What enabled modules put in the footer for a visitor to set, such as the
 * currency prices are shown in, in the order they ask for. Core's footer
 * draws them under the language; a theme's footer draws them where it keeps
 * its controls, so none goes missing when the footer is the theme's.
 *
 * Each sits in its own `data-footer-control` box, which is how a theme dresses
 * a control whose markup is a module's and may change under it.
 */
export function FooterModuleControls() {
    const moduleStatus = useAllModules();
    return (
        <>
            {ModuleFooterComponents
                .filter((fc) => isEnabledIn(moduleStatus, fc.module) && FooterComponentRegistry[fc.id])
                .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
                .map((fc) => {
                    const Comp = FooterComponentRegistry[fc.id];
                    return (
                        <div key={fc.id} data-footer-control="">
                            <ModuleErrorBoundary>
                                <Comp />
                            </ModuleErrorBoundary>
                        </div>
                    );
                })}
        </>
    );
}
