"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link as LinkIcon, Upload, X, Images } from "lucide-react";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { FileUpload } from "@/core/components/ui/file-upload";
import { cn } from "@/core/lib/utils";
import { FilePreview } from "@/core/components/ui/file-preview";
import { Button } from "@/core/components/ui/button";
import { MediaPicker } from "@/core/components/ui/media-picker";
import { Radio } from "@/core/components/ui/radio";

export interface UrlOrFileProps {
    value: string;
    onChange: (url: string) => void;
    label?: string;
    accept?: string;
    placeholder?: string;
    /**
     * Names the control a caller's own `<Label htmlFor>` points at. It lands
     * on whichever control the current mode draws, because that is the one a
     * reader is about to type into or press.
     */
    id?: string;
    /** Where an upload goes; see `FileUploadProps`. */
    endpoint?: string;
    /**
     * False draws a link field and nothing else.
     *
     * An operator can close member uploads, and the endpoint refuses one when
     * they have - but a screen that still offers the button is a control whose
     * only outcome is a refusal. Whoever knows the switch passes the answer
     * down; the field itself reads no settings.
     */
    canUpload?: boolean;
}

type Mode = "link" | "upload";

/** The library's own upload door. A field posting elsewhere is not an
 * operator's field, and `/api/v1/media` would refuse whoever is using it. */
const LIBRARY_ENDPOINT = "/api/v1/upload";

function detectMode(value: string): Mode {
    if (value && value.startsWith("/uploads/")) return "upload";
    return "link";
}

export function UrlOrFile({
    value,
    onChange,
    label,
    accept,
    placeholder = "https://...",
    id,
    endpoint,
    canUpload = true,
}: UrlOrFileProps) {
    const t = useTranslations("common");
    // A field that cannot upload is a link field, whatever it holds: the
    // choice is not drawn, so a mode nobody can leave would be a dead end.
    const [mode, setMode] = useState<Mode>(() => (canUpload ? detectMode(value) : "link"));
    const [browsing, setBrowsing] = useState(false);

    /*
     * The library is an operator's shelf: `/api/v1/media` is admin only, so a
     * field that uploads somewhere else - a member's avatar - is not offered
     * a shelf it would be refused from. Derived rather than asked for,
     * because the two are the same fact: the door and the shelf belong to the
     * same surface.
     */
    const hasLibrary = canUpload && (endpoint ?? LIBRARY_ENDPOINT) === LIBRARY_ENDPOINT;

    const handleModeChange = (next: Mode) => {
        setMode(next);
    };

    return (
        <div className="space-y-2">
            {label && <Label htmlFor={id}>{label}</Label>}

            <div className={cn("flex gap-2", !canUpload && "hidden")}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
                    <Radio
                        name={`url-or-file-${label || "field"}`}
                        checked={mode === "link"}
                        onChange={() => handleModeChange("link")}
                    />
                    <LinkIcon className="h-3.5 w-3.5" />
                    <span>{t("linkUrl")}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
                    <Radio
                        name={`url-or-file-${label || "field"}`}
                        checked={mode === "upload"}
                        onChange={() => handleModeChange("upload")}
                    />
                    <Upload className="h-3.5 w-3.5" />
                    <span>{t("uploadFile")}</span>
                </label>
                {hasLibrary && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setBrowsing(true)}>
                        <Images className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("mediaLibrary")}
                    </Button>
                )}
            </div>

            {browsing && (
                <MediaPicker accept={accept} onPick={onChange} onClose={() => setBrowsing(false)} />
            )}

            {mode === "link" ? (
                <>
                    <Input
                        id={id}
                        type="url"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder} aria-label={placeholder}
                    />
                    {/* The same preview the picker draws. A pasted address is
                        the same image at the same place, and an operator who
                        pasted the wrong one used to find out when the page
                        shipped. */}
                    {value && (
                        <FilePreview value={value} accept={accept}>
                            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
                                <X className="h-3 w-3" aria-hidden="true" />
                                {t("remove")}
                            </Button>
                        </FilePreview>
                    )}
                </>
            ) : (
                <FileUpload
                    id={id}
                    endpoint={endpoint}
                    value={value || null}
                    onChange={(url) => onChange(url || "")}
                    accept={accept}
                />
            )}
        </div>
    );
}
