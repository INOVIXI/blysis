import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { safeUrl } from "../../module-sources/popups/lib/safe-url";

/**
 * The popups module shipped two renderers for the same popup. The one that
 * rendered through `layoutComponents` validated its URLs and carried a comment
 * saying why; the one that rendered through the `layout.overlay` slot passed
 * `popup.link` straight into an `href` and `popup.image` straight into a `src`.
 * Both were on screen at once, so the validation the first one did bought
 * nothing - the unguarded copy was right underneath it.
 *
 * One renderer survives, and this is the rule it enforces.
 */
describe("safeUrl", () => {
    it("keeps https for both an image and a link", () => {
        expect(safeUrl("https://cdn.example.com/a.png", false)).toBe("https://cdn.example.com/a.png");
        expect(safeUrl("https://example.com/sale", true)).toBe("https://example.com/sale");
    });

    it("allows plain http only where it was asked for", () => {
        expect(safeUrl("http://example.com/sale", true)).toBe("http://example.com/sale");
        // An image over http on an https page is blocked by the browser anyway.
        expect(safeUrl("http://cdn.example.com/a.png", false)).toBeNull();
    });

    it("drops every scheme that can execute or smuggle content", () => {
        for (const url of [
            "javascript:alert(document.cookie)",
            "JavaScript:alert(1)",
            "  javascript:alert(1)",
            "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
            "vbscript:msgbox(1)",
            "file:///etc/passwd",
            "//evil.example.com/x",
        ]) {
            expect(safeUrl(url, true), url).toBeNull();
            expect(safeUrl(url, false), url).toBeNull();
        }
    });

    it("keeps a same-origin path, which is what an upload hands back", () => {
        // /api/v1/upload returns a site-relative "/uploads/<key>" for local
        // storage, so refusing relative urls silently blanked every popup image
        // that was uploaded through the admin form rather than pasted in.
        expect(safeUrl("/uploads/2026/popup.png", false)).toBe("/uploads/2026/popup.png");
        expect(safeUrl("/store", true)).toBe("/store");
        // A protocol-relative url only looks relative; it points at another host.
        expect(safeUrl("//evil.example.com/a.png", false)).toBeNull();
    });

    it("treats a missing url as no url", () => {
        expect(safeUrl(null, true)).toBeNull();
        expect(safeUrl(undefined, true)).toBeNull();
        expect(safeUrl("", true)).toBeNull();
    });
});

describe("the popup renderer", () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), "module-sources/popups/slots/PopupRenderer.tsx"),
        "utf8",
    );

    it("puts nothing in an href or a src that did not go through safeUrl", () => {
        expect(source).toContain("const image = safeUrl(popup.image, false);");
        expect(source).toContain("const link = safeUrl(popup.link, true);");
        expect(source).not.toMatch(/href=\{popup\.link\}/);
        expect(source).not.toMatch(/src=\{popup\.image\}/);
    });

    it("closes on Escape, not only on a backdrop click", () => {
        // Escape, the Tab trap and returning focus all come from the shared
        // hook now; the popup's job is to use it and hand it `dismiss`.
        expect(source).toContain("useModalDialog");
        // The call read as one literal string, closing bracket included, so
        // passing the hook an option broke this rather than the behaviour.
        expect(source).toMatch(/useModalDialog<HTMLDivElement>\(popup !== null, dismiss\b/);
    });

    it("takes focus itself rather than ringing the button that closes it", () => {
        // Nobody opened this dialog. Sending focus to its first control means
        // that control matches `:focus-visible` the instant it appears, so a
        // visitor who had clicked nothing was shown a ring around "Close".
        expect(source).toContain('autoFocus: "dialog"');
    });

    it("names its dismiss button from the catalogue", () => {
        expect(source).not.toContain(">Dismiss<");
        expect(source).toContain('{t("close")}');
    });
});
