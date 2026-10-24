/**
 * The landscape a Quarry hero stands on until the operator uploads a picture
 * of their own: a dusk sky in flat bands, a square sun, blocky hills, two
 * trees and the grass over the dirt. Flat colours only, no texture.
 *
 * It is drawn rather than shipped as a picture of the game, whose artwork is
 * not ours to hand out with every install. Decorative, so hidden from
 * assistive technology.
 */
export function Scene() {
    return (
        <svg aria-hidden="true" className="qr-scene" viewBox="0 0 1440 600" preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges">
            <rect width="1440" height="600" fill="#2b2457" />
            <rect y="120" width="1440" height="120" fill="#3a2d6b" />
            <rect y="240" width="1440" height="90" fill="#5a3a78" />
            <rect y="330" width="1440" height="60" fill="#8a4a6f" />
            <rect x="1010" y="250" width="110" height="110" fill="#ffb15c" />
            <rect x="1030" y="270" width="70" height="70" fill="#ffd08a" />
            <polygon points="560,600 560,360 640,360 640,300 720,300 720,250 800,250 800,320 880,320 880,280 960,280 960,340 1040,340 1040,300 1120,300 1120,360 1200,360 1200,320 1280,320 1280,380 1360,380 1360,340 1440,340 1440,600" fill="#3b3a73" />
            <polygon points="0,600 0,430 120,430 120,390 240,390 240,440 400,440 400,400 520,400 520,450 680,450 680,410 820,410 820,460 980,460 980,420 1120,420 1120,470 1280,470 1280,430 1440,430 1440,600" fill="#26294f" />
            <rect x="1160" y="360" width="28" height="110" fill="#1a1c38" />
            <rect x="1124" y="300" width="100" height="72" fill="#1d3a2a" />
            <rect x="1144" y="280" width="60" height="22" fill="#1d3a2a" />
            <rect x="1300" y="380" width="22" height="90" fill="#1a1c38" />
            <rect x="1270" y="330" width="82" height="60" fill="#1d3a2a" />
            <rect y="500" width="1440" height="24" fill="#2f6e1c" />
            <rect y="524" width="1440" height="76" fill="#1d1712" />
            <rect x="760" y="470" width="12" height="30" fill="#5a3c22" />
            <rect x="756" y="456" width="20" height="16" fill="#ffc46b" />
            <rect x="1030" y="470" width="12" height="30" fill="#5a3c22" />
            <rect x="1026" y="456" width="20" height="16" fill="#ffc46b" />
        </svg>
    );
}
