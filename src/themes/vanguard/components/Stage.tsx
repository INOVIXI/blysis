/**
 * The backdrop a Vanguard page opens on: the night sky, a glow, a few pixels
 * of light and three ridges of blocky hills, the nearest one the colour of
 * the page so the stage ends in the ground the content stands on.
 *
 * It is the background of the section it is placed in and stretches with
 * that section, never a band of fixed height: a long title or a second row of
 * buttons makes the stage taller rather than running off its bottom edge.
 * Decorative throughout, so it is hidden from assistive technology.
 */
export function Stage({ tall = false }: { tall?: boolean }) {
    return (
        <div aria-hidden="true" className="vg-stage" data-tall={tall || undefined}>
            <div className="vg-stage-sky">
                <span className="vg-pixel" style={{ left: "31%", top: "14%" }} />
                <span className="vg-pixel" data-size="s" style={{ left: "48%", top: "9%" }} />
                <span className="vg-pixel" data-size="l" style={{ left: "58%", top: "22%" }} />
                <span className="vg-pixel" data-tone="ice" style={{ left: "66%", top: "12%" }} />
                <span className="vg-pixel" data-size="s" data-tone="ice" style={{ left: "39%", top: "30%" }} />
                <span className="vg-pixel" style={{ left: "72%", top: "34%" }} />
                <span className="vg-pixel" data-size="s" style={{ left: "84%", top: "18%" }} />
            </div>
            <div className="vg-ridge" data-depth="far" />
            <div className="vg-ridge" data-depth="near" />
            <div className="vg-ridge" data-depth="ground" />
        </div>
    );
}
