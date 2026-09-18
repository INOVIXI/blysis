"use client";

import { useLocale, useTranslations } from "next-intl";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { Button } from "@/core/components/ui/button";
import { CheckCircle, X } from "lucide-react";
import type { MarketplaceModule } from "./types";
import { moduleDescription, moduleName } from "./module-name";
import { useLocalDate } from "@/core/hooks/useLocalDate";

interface DetailProps {
    module: MarketplaceModule;
    onClose: () => void;
}

export function ModuleDetailModal({ module: mod, onClose }: DetailProps) {
    const locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const t = useTranslations("admin");

    // The modal is only ever rendered while it is open, so the hook is always
    // told it is open.
    const dialogRef = useModalDialog<HTMLDivElement>(true, onClose);

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="presentation">
            <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="module-detail-title"
                className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-start justify-between p-5 border-b">
                    <div className="min-w-0">
                        <h2 id="module-detail-title" className="text-lg font-semibold flex items-center gap-2 flex-wrap">
                            {moduleName(mod, locale, t)}
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">
                                v{mod.version}
                            </span>
                            {mod.verified && <CheckCircle className="w-4 h-4 text-primary" />}
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            by {mod.author} · updated {formatDate(mod.updatedAt)}
                        </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("common_close")}>
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <div className="overflow-y-auto flex-1 p-5 space-y-5">
                    <div>
                        <p className="text-sm">{moduleDescription(mod, locale, t)}</p>
                    </div>

                    {mod.tags && mod.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {mod.tags.map((tag) => (
                                <span key={tag} className="px-2 py-0.5 text-[10px] rounded-full bg-muted/60 text-muted-foreground">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {mod.dependencies.length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">{t("modules_dependencies")}</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {mod.dependencies.map((dep) => (
                                    <span key={dep} className="px-2 py-0.5 text-xs rounded bg-muted text-foreground">{dep}</span>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
