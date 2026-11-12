"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface SlideItem {
    id: string;
    title: string | null;
    subtitle: string | null;
    image: string;
    link: string | null;
}

export function SliderWidget() {
    const t = useTranslations("common");
    const sliderT = useTranslations("slider");
    // The endpoint reads each slide in this language, and the original where
    // the admin wrote none.
    const locale = useLocale();
    const [slides, setSlides] = useState<SlideItem[]>([]);
    const [current, setCurrent] = useState(0);

    useEffect(() => {
        // A reader who switched language before the answer came back is not
        // shown the slides in the one they left.
        let active = true;
        fetch(`/api/v1/slider?locale=${encodeURIComponent(locale)}`)
            .then((r) => r.json())
            .then((d) => { if (active) setSlides(d.items || []); })
            .catch(() => {});
        return () => { active = false; };
    }, [locale]);

    const next = useCallback(() => {
        setCurrent((c) => (c + 1) % slides.length);
    }, [slides.length]);

    const prev = useCallback(() => {
        setCurrent((c) => (c - 1 + slides.length) % slides.length);
    }, [slides.length]);

    // Auto-advance
    useEffect(() => {
        if (slides.length <= 1) return;
        const timer = setInterval(next, 5000);
        return () => clearInterval(timer);
    }, [slides.length, next]);

    if (slides.length === 0) return null;

    const slide = slides[current];
    const Wrapper = slide.link ? "a" : "div";
    const wrapperProps = slide.link ? { href: slide.link, target: "_blank" as const, rel: "noopener noreferrer" } : {};

    return (
        <div className="relative rounded-xl overflow-hidden mb-6">
            <Wrapper {...wrapperProps} className="block relative aspect-[21/9] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.image} alt={slide.title || ""} className="w-full h-full object-cover" />
                {(slide.title || slide.subtitle) && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-6">
                        {slide.title && <h2 className="text-white font-bold text-lg">{slide.title}</h2>}
                        {slide.subtitle && <p className="text-white/80 text-sm">{slide.subtitle}</p>}
                    </div>
                )}
            </Wrapper>

            {slides.length > 1 && (
                <>
                    <button onClick={prev} aria-label={t("previous")} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 hover:bg-white flex items-center justify-center shadow">
                        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button onClick={next} aria-label={t("next")} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 hover:bg-white flex items-center justify-center shadow">
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {slides.map((_, i) => (
                            <button
                                key={i}
                                aria-label={sliderT("goToSlide", { n: i + 1 })}
                                aria-current={i === current ? "true" : undefined}
                                onClick={() => setCurrent(i)}
                                className={`w-2 h-2 rounded-full transition-colors ${i === current ? "bg-white" : "bg-white/50"}`}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
