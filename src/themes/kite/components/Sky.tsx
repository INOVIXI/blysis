/**
 * Kite's drawings: the floating island, the kite on its string and the
 * clouds. Every part is coloured by a class that `theme.css` paints from the
 * theme's tokens, so the operator's colours and the night mode reach the
 * drawing too; nothing here names a colour.
 */

interface DrawingProps {
    className?: string;
}

/** A cloud of three puffs on a flat base, 140 by 64 in its own units. */
export function Cloud({ className }: DrawingProps) {
    return (
        <svg aria-hidden="true" viewBox="0 0 140 64" className={className}>
            <path className="kt-cloud" d="M4 60c0-15 12-27 27-27 6-17 22-29 41-29 20 0 37 14 41 33h7c17 0 31 14 31 31H4z" />
        </svg>
    );
}

/** The kite on its own, nose up, with a tail of two bows. */
export function KiteMark({ className }: DrawingProps) {
    return (
        <svg aria-hidden="true" viewBox="-40 -52 80 128" className={className}>
            <path className="kt-kite" d="M0-48 34 0 0 48-34 0z" />
            <path className="kt-kite-spar" d="M0-48V48M-34 0h68" />
            <path className="kt-kite-tail" d="M0 48c-8 14 8 20-2 34" />
            <path className="kt-kite-bow" d="M-6 66l10-4" />
        </svg>
    );
}

/**
 * The missing page's picture: a kite drifting off with the broken end of its
 * string, and the spool it came from left on the ground.
 */
export function LostKite({ className }: DrawingProps) {
    return (
        <svg aria-hidden="true" viewBox="0 0 520 440" className={className}>
            <path className="kt-cloud" d="M30 120c0-14 11-25 25-25 5-16 20-27 38-27 19 0 34 13 38 31h6c15 0 28 12 28 28H30z" />
            <path className="kt-cloud kt-cloud-far" d="M320 300c0-12 10-22 22-22 5-14 18-24 33-24 17 0 30 11 34 27h5c13 0 24 11 24 24H320z" />
            <g transform="translate(392 92) rotate(28)">
                <path className="kt-kite" d="M0-48 36 0 0 48-36 0z" />
                <path className="kt-kite-spar" d="M0-48V48M-36 0h72" />
                <path className="kt-kite-tail" d="M0 48c-10 14 10 20-2 34s8 20-4 30" />
            </g>
            <path className="kt-string" d="M368 150c-30 40-70 70-110 96" />
            <path className="kt-string" d="M150 330c40-20 70-40 90-62" />
            <path className="kt-string-break" d="M244 262l10 6M252 254l8 10" />
            <g transform="translate(130 360)">
                <rect className="kt-soil" x="-34" y="-22" width="68" height="44" rx="10" />
                <rect className="kt-sun" x="-22" y="-30" width="44" height="60" rx="8" />
                <circle className="kt-soil" r="8" />
            </g>
        </svg>
    );
}

/**
 * The homepage's picture: a grassy island floating in the sky, a tree and a
 * small house on it, the sun behind, and a kite on a string from the island.
 * `label` describes it for a screen reader; without one it is decoration.
 */
export function Island({ className, label }: DrawingProps & { label?: string }) {
    return (
        <svg
            viewBox="0 0 560 440"
            className={className}
            {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
        >
            <circle className="kt-sun-glow" cx="452" cy="86" r="66" />
            <circle className="kt-sun" cx="452" cy="86" r="50" />
            <path className="kt-string" d="M118 264c80-70 160-150 238-202" />
            <g transform="translate(356 62) rotate(18)">
                <path className="kt-kite" d="M0-46 34 0 0 46-34 0z" />
                <path className="kt-kite-spar" d="M0-46V46M-34 0h68" />
                <path className="kt-kite-tail" d="M0 46c-8 14 8 20-2 34s6 22-4 32" />
                <path className="kt-kite-bow" d="M-6 66l10-4M-8 88l11-2" />
            </g>
            <path className="kt-soil" d="M92 272h330l-20 30h-24l-16 34h-34l-14 40h-40l-10 34h-34l-12-34h-36l-14-40h-34l-16-34h-26z" />
            <path className="kt-soil-seam" d="M118 302h278M150 336h210M190 376h134" />
            <rect className="kt-grass" x="84" y="252" width="346" height="28" rx="12" />
            <rect className="kt-grass-shade" x="84" y="270" width="346" height="12" />
            <rect className="kt-wood" x="150" y="190" width="20" height="64" />
            <rect className="kt-leaf" x="114" y="138" width="92" height="64" rx="10" />
            <rect className="kt-leaf-light" x="128" y="118" width="64" height="40" rx="10" />
            <rect className="kt-wall" x="260" y="196" width="104" height="58" />
            <path className="kt-roof" d="M248 200 312 150 376 200z" />
            <rect className="kt-door" x="300" y="218" width="24" height="36" rx="4" />
            <rect className="kt-window" x="272" y="212" width="18" height="18" rx="3" />
            <rect className="kt-window" x="334" y="212" width="18" height="18" rx="3" />
            <path className="kt-cloud" d="M28 360c0-14 11-25 25-25 5-16 20-27 38-27 19 0 34 13 38 31h6c15 0 28 12 28 28H28z" />
            <path className="kt-cloud kt-cloud-far" d="M392 404c0-12 10-22 22-22 5-14 18-24 33-24 17 0 30 11 34 27h5c13 0 24 11 24 24H392z" />
        </svg>
    );
}
