"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { ModalLayer } from "@/core/components/ui/modal-layer";

/**
 * A picture, at the size it was uploaded.
 *
 * Every gallery in the product stopped at a thumbnail. The shop's product
 * page has arrows, dots, a counter and a thumbnail strip, and all four of them
 * only ever swapped which 16:9 crop was on screen - there was no way to see a
 * rank banner or a crate render at its own size, which on a page whose job is
 * selling the thing is the one interaction a shopper reaches for first.
 *
 * `contain`, not `cover`: a lightbox that crops has thrown away the reason
 * somebody opened it.
 *
 * Escape, the arrow keys and a click on the backdrop all close or move it, and
 * `useModalDialog` holds the focus and gives it back - the same behaviour the
 * confirm dialog and the media picker use, rather than a twelfth hand-written
 * overlay.
 */

export interface ImageLightboxProps {
    images: string[];
    /** Which one is open. `null` is closed. */
    index: number | null;
    onIndexChange: (index: number) => void;
    onClose: () => void;
    /** Names the picture for a screen reader; the caller knows what it is of. */
    label: string;
}

export function ImageLightbox({ images, index, onIndexChange, onClose, label }: ImageLightboxProps) {
    const t = useTranslations("common");
    const open = index !== null && images.length > 0;
    const ref = useModalDialog<HTMLDivElement>(open, onClose);

    const step = React.useCallback(
        (by: number) => {
            if (index === null || images.length === 0) return;
            onIndexChange((index + by + images.length) % images.length);
        },
        [index, images.length, onIndexChange],
    );

    React.useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "ArrowRight") step(1);
            if (event.key === "ArrowLeft") step(-1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, step]);

    if (!open || index === null) return null;

    return (
        <ModalLayer>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* The scrim is its own element, hidden from assistive technology
                    and carrying the click that closes. Held apart from the dialog
                    because a `<div>` that is both is a control with no keyboard
                    path; the way out with a keyboard is Escape and the close
                    button, and the scrim is decoration over them.

                    Deliberately not a theme colour either: it sits over somebody's
                    photograph, and a light theme's surface behind a light picture
                    is no scrim at all. */}
                <div aria-hidden="true" onClick={onClose} className="fixed inset-0 bg-black/80" />
            <div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                className="relative flex h-full w-full items-center justify-center"
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t("close")}
                    className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                >
                    <X className="h-5 w-5" aria-hidden="true" />
                </button>

                {images.length > 1 && (
                    <>
                        <button
                            type="button"
                            onClick={() => step(-1)}
                            aria-label={t("previous")}
                            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
                        >
                            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            onClick={() => step(1)}
                            aria-label={t("next")}
                            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
                        >
                            <ChevronRight className="h-6 w-6" aria-hidden="true" />
                        </button>
                    </>
                )}

                <div className="relative h-full max-h-[85vh] w-full max-w-5xl">
                    <Image
                        src={images[index]}
                        alt={label}
                        fill
                        // Whatever host the picture came from is not core's to
                        // optimise, and an operator's own upload is already served
                        // from this origin.
                        unoptimized
                        className="object-contain"
                    />
                </div>

                {images.length > 1 && (
                    <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm text-white">
                        {index + 1} / {images.length}
                    </p>
                )}
            </div>
            </div>
        </ModalLayer>
    );
}
