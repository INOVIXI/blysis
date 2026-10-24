"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ImageLightbox } from "@/core/sdk/ui";

/**
 * A product's pictures: the one open, arrows and dots between them, a strip
 * of the rest, and any of them whole on a press. The product page's
 * `gallery` block.
 */
export function ProductGallery({ name, image, images: given }: { name: string; image: string | null; images?: string[] }) {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    // Which image is open at full size. Null is closed.
    const [zoomed, setZoomed] = useState<number | null>(null);

    const images = given?.length ? given : image ? [image] : ["/placeholder.svg"];

    const nextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

    const prevImage = () => {
        setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
    };

    return (
        <div className="space-y-6">
            {/* The same frame the shelf used, so the artwork an operator
                uploaded is cropped once rather than twice: 2:1 on the card and
                16:9 here meant the top and bottom of every product banner
                appeared and disappeared between the two screens. */}
            <div className="relative aspect-card overflow-hidden rounded-lg bg-muted">
                {/* The picture is the thing being sold, and the card crops it
                    to 16:9. Pressing it opens it whole. */}
                <button
                    type="button"
                    onClick={() => setZoomed(currentImageIndex)}
                    aria-label={t("product_enlarge")}
                    className="absolute inset-0 z-0 cursor-zoom-in"
                >
                    <Image
                        src={images[currentImageIndex]}
                        alt={`${name} - Image ${currentImageIndex + 1}`}
                        fill
                        className="object-cover"
                    />
                </button>

                {images.length > 1 && (
                    <>
                        <button
                            onClick={prevImage}
                            aria-label={commonT("previous")}
                            className="absolute left-4 top-1/2 z-10 -translate-y-1/2 w-10 h-10 rounded-full bg-card/80 hover:bg-card flex items-center justify-center shadow-lg transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-foreground" aria-hidden="true" />
                        </button>
                        <button
                            onClick={nextImage}
                            aria-label={commonT("next")}
                            className="absolute right-4 top-1/2 z-10 -translate-y-1/2 w-10 h-10 rounded-full bg-card/80 hover:bg-card flex items-center justify-center shadow-lg transition-colors"
                        >
                            <ChevronRight className="w-5 h-5 text-foreground" aria-hidden="true" />
                        </button>
                    </>
                )}

                {images.length > 1 && (
                    <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 flex gap-2">
                        {images.map((_, index) => (
                            <button
                                key={index}
                                aria-label={t("product_goToImage", { n: index + 1 })}
                                aria-current={index === currentImageIndex ? "true" : undefined}
                                onClick={() => setCurrentImageIndex(index)}
                                className={`w-2 h-2 rounded-full transition-colors ${index === currentImageIndex ? "bg-card" : "bg-card/50"}`}
                            />
                        ))}
                    </div>
                )}

                <div className="absolute top-4 right-4 z-10 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
                    {currentImageIndex + 1} / {images.length}
                </div>
            </div>

            {/* Thumbnail Strip */}
            {images.length > 1 && (
                <div className="flex gap-3">
                    {images.map((img, index) => (
                        <button
                            key={index}
                            onClick={() => setCurrentImageIndex(index)}
                            aria-label={t("product_thumbnail", { n: index + 1 })}
                            className={`relative aspect-card w-20 overflow-hidden rounded-lg border-2 transition-colors ${index === currentImageIndex ? "border-primary/30" : "border-border hover:border-border"}`}
                        >
                            <Image
                                src={img}
                                alt={t("product_thumbnail", { n: index + 1 })}
                                fill
                                className="object-cover"
                            />
                        </button>
                    ))}
                </div>
            )}

            <ImageLightbox
                images={images}
                index={zoomed}
                onIndexChange={setZoomed}
                onClose={() => setZoomed(null)}
                label={name}
            />
        </div>
    );
}
