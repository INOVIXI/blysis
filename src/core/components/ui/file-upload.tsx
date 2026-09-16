"use client";

import { useRef, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { FilePreview } from "@/core/components/ui/file-preview";
import { toast } from "sonner";
import { Button } from "@/core/components/ui/button";
import { Label } from "@/core/components/ui/label";
import { useTranslations } from "next-intl";
import { errorMessage } from "@/core/lib/write-result";

export interface FileUploadProps {
    value: string | null;
    onChange: (url: string | null) => void;
    accept?: string;
    label?: string;
    /**
     * Names the picker for a caller that draws its own label. The id lands on
     * the visible button rather than the file input, which is hidden and so
     * reaches no one; a `<button>` is labelable, so clicking the label opens
     * the picker.
     */
    id?: string;
    /**
     * Where the bytes go. The media library by default, which is an
     * operator's tool and admin only; a screen a member uses names its own
     * narrower door instead. What is on the other side decides the limits -
     * this component only sends the file.
     */
    endpoint?: string;
}

export function FileUpload({ value, onChange, accept, label, id, endpoint = "/api/v1/upload" }: FileUploadProps) {
    const t = useTranslations("common");
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    const handlePick = () => {
        inputRef.current?.click();
    };

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch(endpoint, {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("uploadFailed"), t));
                return;
            }

            const data = (await res.json()) as { url: string; path: string };
            onChange(data.url);
            toast.success(t("fileUploaded"));
        } catch {
            toast.error(t("uploadFailed"));
        } finally {
            setUploading(false);
        }
    };

    const handleRemove = () => {
        onChange(null);
    };

    return (
        <div className="space-y-2">
            {label && <Label htmlFor={id}>{label}</Label>}

            {value && (
                <FilePreview value={value} accept={accept}>
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handlePick}
                        disabled={uploading}
                    >
                        {uploading ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                            <Upload className="h-3 w-3" aria-hidden="true" />
                        )}
                        {t("replace")}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemove}
                        disabled={uploading}
                    >
                        <X className="h-3 w-3" aria-hidden="true" />
                        {t("remove")}
                    </Button>
                </FilePreview>
            )}

            {!value && (
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    onClick={handlePick}
                    disabled={uploading}
                >
                    {uploading ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            {t("uploading")}
                        </>
                    ) : (
                        <>
                            <Upload className="h-4 w-4" aria-hidden="true" />
                            {t("uploadFile")}
                        </>
                    )}
                </Button>
            )}

            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={handleChange}
                aria-label={t("uploadFile")}
                className="hidden"
            />
        </div>
    );
}
