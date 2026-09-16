"use client";

import { useTranslations } from "next-intl";
import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * What a file field is holding, drawn once for every field that holds one.
 *
 * It used to live inside `FileUpload`, which meant a field showed its value
 * only when the value had been uploaded through that picker. `UrlOrFile`
 * offers the same field two ways, so pasting the same image at the same
 * address showed nothing at all, and a wrong URL was found out when the page
 * shipped. The preview belongs to the field rather than to one of the ways
 * of filling it.
 *
 * It takes its actions as children because the two callers owe different
 * ones: a picker offers to replace, a pasted link only to clear.
 */
export function FilePreview({
    value,
    accept,
    className,
    children,
}: {
    value: string;
    /** The MIME prefix the field asked for, used to guess before it loads. */
    accept?: string;
    className?: string;
    /** The controls that act on this value. */
    children?: React.ReactNode;
}) {
    const t = useTranslations("common");
    const isImage = looksLikeImage(value, accept);

    return (
        <div className={cn("flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3", className)}>
            {isImage ? (
                /*
                 * A plain `img`, not `next/image`. The value is an address
                 * somebody typed or a path a storage provider returned, and
                 * which provider answered is not core's business - the
                 * optimiser would need every possible host configured in
                 * advance, which is the opposite of a pluggable provider.
                 */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={value}
                    alt={t("preview")}
                    className="h-20 w-20 rounded object-contain border border-border bg-muted p-1"
                />
            ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded border border-border bg-muted text-muted-foreground">
                    <ImageIcon className="h-6 w-6" aria-hidden="true" />
                </div>
            )}
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground" title={value}>
                    {value}
                </p>
                {children ? <div className="mt-2 flex gap-2">{children}</div> : null}
            </div>
        </div>
    );
}

/**
 * Looks like an image, by what the field asked for or by what the address
 * ends in. A field that says `image/*` is believed before the file loads.
 */
export function looksLikeImage(value: string | null, accept?: string): boolean {
    if (accept && accept.startsWith("image/")) return true;
    if (!value) return false;
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(value);
}
