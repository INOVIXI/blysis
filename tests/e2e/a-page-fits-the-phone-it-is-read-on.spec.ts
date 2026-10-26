import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * Nothing on a public page is wider than the phone reading it.
 *
 * A single element that refuses to wrap does not just look wrong itself. The
 * document grows wider than the viewport, and a mobile browser answers that by
 * zooming the whole page out to fit - so every fixed overlay is then laid out
 * against the wider page rather than the screen. Measured on a 320px phone:
 * the announcement bar's text was one unbreakable 510px line, the document
 * became 554px, and the navigation drawer (`w-[85%] max-w-sm`) came out 384px
 * wide on a 320px screen, sitting over a page drawn at 58% scale.
 *
 * The cause was `truncate` on an inline `<span>`. On an inline box `overflow`
 * and `text-overflow` do nothing at all, so the only half of the utility that
 * applied was `white-space: nowrap`: the ellipsis never appeared and the line
 * never broke. It belongs on the block that holds the text.
 *
 * So the rule is measured on the page rather than read off the class names,
 * because the next version of this bug will wear different classes.
 *
 * What a rail that scrolls sideways holds is not counted against the screen,
 * as long as the rail itself fits it: a leaderboard widget's tabs run past the
 * edge by design and are reached by swiping the rail, and the page does not
 * grow by a pixel for them. Only `auto` and `scroll` count as such a rail.
 * `hidden` and `clip` cut content off where no reader can reach it, and the
 * document element never counts, since its scroll is the very thing measured.
 */

test.use({ viewport: { width: 320, height: 658 }, isMobile: true, hasTouch: true });

/** The pages a visitor lands on, one per kind of layout. */
const PAGES = ["/tr", "/tr/blog", "/tr/store", "/tr/forum", "/en"];

/** What on the page is wider than the screen, and how wide the document became. */
async function measure(page: Page) {
    return page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        const inRailThatFits = (el: Element) => {
            for (let up = el.parentElement; up && up !== document.body && up !== document.documentElement; up = up.parentElement) {
                if (!["auto", "scroll"].includes(getComputedStyle(up).overflowX)) continue;
                const box = up.getBoundingClientRect();
                return box.left >= -1 && box.right <= viewport + 1;
            }
            return false;
        };
        const offenders = [...document.querySelectorAll<HTMLElement>("*")]
            .filter((el) => !inRailThatFits(el))
            .filter((el) => {
                const box = el.getBoundingClientRect();
                return box.width > viewport + 1 || box.right > viewport + 1;
            })
            // The innermost one is the cause; its ancestors are victims.
            .filter((el) => ![...el.children].some((child) => {
                const box = child.getBoundingClientRect();
                return box.width > viewport + 1 || box.right > viewport + 1;
            }))
            // The attribute, not `className`: on an SVG element that is an
            // SVGAnimatedString, and an offender was named "[object ...]".
            .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ").slice(0, 3).join(".")}`);
        return { viewport, documentWidth: document.documentElement.scrollWidth, offenders };
    });
}

async function expectToFit(page: Page) {
    const report = await measure(page);
    expect(report.offenders, `wider than the ${report.viewport}px screen`).toEqual([]);
    expect(report.documentWidth).toBeLessThanOrEqual(report.viewport + 1);
}

for (const path of PAGES) {
    test(`${path} fits a 320px phone`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        // The announcement bar and the cookie notice both arrive after their
        // own fetch, and both were offenders.
        await page.waitForTimeout(1500);
        await expectToFit(page);
    });
}

/*
 * A table that scrolls sideways in a box of its own still pushed the page:
 * the punishment record says who lifted a punishment in text read but not
 * seen, which is positioned, and the box it scrolls in was not, so the text
 * was placed against the page past the table's last column. The document
 * grew to 812px on a 390px phone.
 */
test("the punishment record fits a 320px phone with a lifted punishment in it", async ({ page, baseURL }) => {
    // Signed in at a desk: on the phone the cookie notice covers the button.
    const phone = page.viewportSize()!;
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.setViewportSize(phone);
    const origin = new URL(baseURL!).origin;
    const made = await page.request.post("/api/v1/punishments", {
        headers: { origin },
        data: { playerName: "phone-check", type: "warning", reason: "Measured on a phone" },
    });
    expect(made.status()).toBe(201);
    const { punishment } = await made.json();
    try {
        const lifted = await page.request.patch(`/api/v1/punishments/${punishment.id}`, {
            headers: { origin },
            data: { active: false, liftReason: "Served long enough" },
        });
        expect(lifted.ok()).toBe(true);
        await page.goto("/tr/punishments");
        await expect(page.getByText("phone-check").first()).toBeVisible();
        // The cookie notice slides in after its own fetch, as on every page above.
        await page.waitForTimeout(1500);
        await expectToFit(page);
    } finally {
        await page.request.delete(`/api/v1/punishments/${punishment.id}`, { headers: { origin } });
    }
});
