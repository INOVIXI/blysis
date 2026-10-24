/**
 * The landscape a Quarry hero stands on until the operator uploads a picture
 * of their own: a dusk sky in flat bands, a square sun, blocky hills, two
 * trees and the grass over the dirt, drawn by `.qr-scene` in `theme.css`.
 *
 * It is drawn rather than shipped as a picture of the game, whose artwork is
 * not ours to hand out with every install. It is a background rather than an
 * inline SVG because it is cropped to the hero, and a cropped SVG leaves its
 * shapes past the edge of a phone's screen, where
 * a-page-fits-the-phone-it-is-read-on counts them. Decorative, so hidden from
 * assistive technology.
 */
export function Scene() {
    return <div aria-hidden="true" className="qr-scene" />;
}
