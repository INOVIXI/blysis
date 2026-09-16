// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NavIcon } from "@/core/components/ui/NavIcon";

/**
 * An icon drawn from a name is the size the caller asked for.
 *
 * Core's own groups import their icons and the rail draws them with the
 * attribute - `<Icon size={18} />`. A module names its icon in a manifest
 * instead, so core resolves that name through `NavIcon`, and the wrapper that
 * does it forwarded the class and not the size. Lucide's own default is 24, so
 * every module's icon in the admin rail and sidebar came out a third larger
 * than the ones beside it, which is what an operator reported.
 *
 * The rule is the two props, because the contract has two and a wrapper that
 * honours one of them looks right until somebody uses the other.
 */
describe("an icon drawn from a name", () => {
    it("takes the size the caller asked for", () => {
        const { container } = render(<NavIcon name="Home" size={18} />);
        const svg = container.querySelector("svg");
        // The placeholder stands in until the icon's own chunk arrives, and it
        // is the box that has to be the right size either way.
        const sized = svg ?? container.querySelector("span");
        expect(sized).not.toBeNull();
        if (svg) {
            expect(svg.getAttribute("width")).toBe("18");
            expect(svg.getAttribute("height")).toBe("18");
        }
    });

    it("still takes a class, which is how most of the site sizes one", () => {
        const { container } = render(<NavIcon name="Home" className="w-4 h-4" />);
        const drawn = container.querySelector("svg") ?? container.querySelector("span");
        expect(drawn?.getAttribute("class")).toContain("w-4");
    });

    /**
     * The chunk arrives after the paint, so whatever stands in its place is
     * on screen first and is swapped for the icon. A `<span>` is inline, and
     * `h-4` does not apply to an inline box - so the stand-in reserved a line
     * box and the icon that replaced it reserved sixteen pixels. Measured on
     * a production build: `/tr/forum` grew 39px after load, which is layout
     * shift on every page carrying a module's icon.
     *
     * An `<svg>` with the same class and the same width and height is the
     * same box as the icon by construction, which is the only version of this
     * that cannot drift.
     */
    it("stands in with the same box the icon will take", () => {
        const { container } = render(<NavIcon name="Home" size={18} className="w-4 h-4" />);
        const drawn = container.firstElementChild;
        expect(drawn?.tagName.toLowerCase()).toBe("svg");
        expect(drawn?.getAttribute("width")).toBe("18");
        expect(drawn?.getAttribute("height")).toBe("18");
    });

    it("hands both on to the fallback as well", () => {
        function Marker({ className, size }: { className?: string; size?: number }) {
            return <i data-testid="fallback" data-size={size} className={className} />;
        }
        const { getByTestId } = render(
            <NavIcon name="nothing-is-called-this" size={15} className="w-3" fallback={Marker} />,
        );
        expect(getByTestId("fallback").getAttribute("data-size")).toBe("15");
        expect(getByTestId("fallback").getAttribute("class")).toBe("w-3");
    });
});
