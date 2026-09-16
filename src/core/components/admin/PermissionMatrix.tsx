"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/core/components/ui/input";
import { cn } from "@/core/lib/utils";

/**
 * What a role says about each permission: yes, never, or nothing.
 *
 * The screen this replaces drew the raw names - `store.manage`,
 * `forum.moderate` - as checkboxes in a grid of module boxes, so deciding
 * what a job involves meant knowing the codebase. And a checkbox has two
 * states where the model has three: with only yes and nothing, an operator can
 * build a role up but never take anything away from somebody who holds
 * another one.
 *
 * Three buttons per row, then, and the middle one is the one that matters:
 * never beats a yes from any other role the member holds, which is how a
 * "muted" role is written once instead of unpicking every role a person has.
 *
 * The filter is not decoration. An installation with ninety modules offers a
 * hundred and three permissions, and the operator arriving here usually knows
 * the word they are looking for.
 */

export type PermissionState = "ALLOW" | "NEVER";

export interface PermissionSection {
    id: string;
    title: string;
    permissions: { name: string; label: string }[];
}

export interface PermissionMatrixProps {
    sections: PermissionSection[];
    /** Only the names this role has an opinion on. Absent is the third state. */
    value: Record<string, PermissionState>;
    onChange: (next: Record<string, PermissionState>) => void;
    disabled?: boolean;
}

export function PermissionMatrix({ sections, value, onChange, disabled }: PermissionMatrixProps) {
    const t = useTranslations("admin");
    const [filter, setFilter] = useState("");

    const shown = useMemo(() => {
        const needle = filter.trim().toLocaleLowerCase();
        if (!needle) return sections;
        return sections
            .map((section) => ({
                ...section,
                permissions: section.permissions.filter(
                    (permission) =>
                        permission.label.toLocaleLowerCase().includes(needle) ||
                        permission.name.toLocaleLowerCase().includes(needle) ||
                        section.title.toLocaleLowerCase().includes(needle),
                ),
            }))
            .filter((section) => section.permissions.length > 0);
    }, [sections, filter]);

    function set(name: string, state: PermissionState | null) {
        const next = { ...value };
        // Removing the key is how the third state is written: a role that says
        // nothing about a permission is not the same as one that refuses it.
        if (state === null) delete next[name];
        else next[name] = state;
        onChange(next);
    }

    const granted = Object.values(value).filter((state) => state === "ALLOW").length;
    const refused = Object.values(value).filter((state) => state === "NEVER").length;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={t("permissions_filter")}
                    className="max-w-xs"
                    aria-label={t("permissions_filter")}
                />
                <p className="text-sm text-muted-foreground">
                    {t("permissions_summary", { granted, refused })}
                </p>
            </div>

            {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("permissions_noneMatch")}</p>
            ) : (
                <div className="space-y-6">
                    {shown.map((section) => (
                        <section key={section.id}>
                            <h3 className="text-sm font-semibold text-foreground mb-2">{section.title}</h3>
                            <div className="border border-border rounded-lg divide-y divide-border">
                                {section.permissions.map((permission) => (
                                    <div
                                        key={permission.name}
                                        className="flex items-center justify-between gap-4 px-3 py-2"
                                    >
                                        <span className="text-sm text-foreground" title={permission.name}>
                                            {permission.label}
                                        </span>
                                        <div className="flex shrink-0 rounded-md border border-border overflow-hidden">
                                            <StateButton
                                                label={t("permissions_yes")}
                                                active={value[permission.name] === "ALLOW"}
                                                tone="allow"
                                                disabled={disabled}
                                                onClick={() => set(permission.name, "ALLOW")}
                                            />
                                            <StateButton
                                                label={t("permissions_never")}
                                                active={value[permission.name] === "NEVER"}
                                                tone="never"
                                                disabled={disabled}
                                                onClick={() => set(permission.name, "NEVER")}
                                            />
                                            <StateButton
                                                label={t("permissions_unset")}
                                                active={value[permission.name] === undefined}
                                                tone="unset"
                                                disabled={disabled}
                                                onClick={() => set(permission.name, null)}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}

function StateButton({
    label,
    active,
    tone,
    disabled,
    onClick,
}: {
    label: string;
    active: boolean;
    tone: "allow" | "never" | "unset";
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            // `aria-pressed` rather than a radio group: three buttons that set
            // one value is what this is, and a screen reader announcing
            // "pressed" says the state without inventing a label for the group.
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                !active && "bg-card text-muted-foreground hover:bg-muted",
                active && tone === "allow" && "bg-success text-white",
                active && tone === "never" && "bg-destructive text-white",
                active && tone === "unset" && "bg-muted text-foreground",
            )}
        >
            {label}
        </button>
    );
}
