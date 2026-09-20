/**
 * A section that reserves room keeps it.
 *
 * The news section says it is waiting while it waits for
 * `/api/v1/blog/articles`, and the room it holds is a minimum height. A
 * minimum is a floor, not a size, and here it was a floor nobody stood on.
 * Measured at 1280px, the same section rendered three different heights:
 * 580px while loading, 532px when the answer was empty, 632px when four
 * articles arrived. The reservation was 532px, which matched neither of the
 * states that actually reach a reader.
 *
 * The difference is the heading. The settled section draws an `h2` above the
 * grid and the skeleton does not, so the skeleton stood in for a shape the
 * page never renders, and the answer arriving moved the footer and
 * everything under it by 48px or 52px depending on whether there was
 * anything to show.
 *
 * The page wide budget in `a-page-settles-and-asks-once.spec.ts` cannot see
 * this. It sums every source of movement at once and this section answers
 * quickly enough to hide inside the rest of the page settling. So this test
 * holds the answer back until everything else has stopped, then asks whether
 * anything moved once it arrived.
 *
 * Page length alone was not enough to ask that. The homepage puts this
 * section beside a column of widgets, and a grid row is as tall as its
 * tallest cell: on a site with widgets to show, the section grew 37px past
 * its reservation and the page did not move at all, because the column next
 * to it was taller than both. The same page on an empty database moved by
 * exactly that 37px. So the section is measured as well, found through the
 * heading a reader sees rather than through a hook added for the test.
 *
 * And the height is asked of two different sets of articles, because the
 * thing that made the reservation wrong was text: a card that sizes itself
 * to its own headline makes the section a different height for every set of
 * articles, so no single number can reserve it.
 */
import { test, expect } from '@playwright/test';

/** Long enough that the rest of the page has finished moving first. */
const HOLD_MS = 4000;

/** Room for the rest of the page to stop moving, once the section is up. */
const SETTLE_MS = 1000;

/** One article in the shape `/api/v1/blog/articles` returns. */
const article = (n: number, text?: { title: string; excerpt: string }) => ({
    id: n,
    number: n,
    slug: `article-${n}`,
    title: text ? `${text.title} ${n}` : `A headline of an ordinary length ${n}`,
    excerpt: text ? text.excerpt : 'A summary of the kind an editor writes, a line or so long.',
    coverImage: null,
    publishedAt: '2026-01-02T10:00:00.000Z',
    createdAt: '2026-01-01T10:00:00.000Z',
    category: { name: 'General', slug: 'general' },
});

/** Long enough that both the headline and the summary run past one line. */
const LONG = {
    title: 'A headline long enough that it runs onto a second line before it ends',
    excerpt: 'A summary of the kind an editor writes when nobody has asked them to be brief, which runs well past the line it was given.',
};

/**
 * The news section, found the way a reader finds it: it is the thing that
 * says it is waiting, and it is the thing under that heading once it has
 * stopped. The heading text is read while it waits and used to find the same
 * box again afterwards, so the component carries no attribute it would not
 * otherwise have and the two states are measured the same way.
 */
const WAITING_SECTION = `(() => {
    let box = document.querySelector('[aria-busy="true"]');
    while (box && !box.querySelector('h2')) box = box.parentElement;
    const heading = box && box.querySelector('h2');
    return box && heading
        ? { heading: (heading.textContent || '').trim(), height: Math.round(box.getBoundingClientRect().height) }
        : null;
})()`;

const sectionUnder = (heading: string) => `(() => {
    const found = Array.from(document.querySelectorAll('h2'))
        .find((node) => (node.textContent || '').trim() === ${JSON.stringify(heading)});
    return found && found.parentElement
        ? Math.round(found.parentElement.getBoundingClientRect().height)
        : null;
})()`;

/**
 * Loads the homepage with the news answer held back, and reports how much
 * the page grew or shrank at the moment it arrived.
 */
async function pageMovementWhenNewsArrives(
    page: import('@playwright/test').Page,
    articles: ReturnType<typeof article>[],
): Promise<{ before: number; after: number; sectionBefore: number | null; sectionAfter: number | null }> {
    await page.route('**/api/v1/blog/articles**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ articles }),
        });
    });

    await page.goto('/tr', { waitUntil: 'load' });

    // Waiting for the waiting region rather than for a stopwatch. A fixed
    // delay reads the page before it is up on a slow machine, and a section
    // that never said it was waiting would pass by having nothing to say.
    // `aria-busy` is what says it now; it used to be a pulsing grey block.
    const waiting = page.locator('[aria-busy="true"]').first();
    await waiting.waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(SETTLE_MS);
    const before = await page.evaluate(() => document.body.scrollHeight);
    const waitingSection = await page.evaluate<{ heading: string; height: number } | null>(WAITING_SECTION);
    if (!waitingSection) throw new Error('nothing on the page said it was waiting');

    await waiting.waitFor({ state: 'detached', timeout: 20_000 });
    await page.waitForTimeout(SETTLE_MS);
    const after = await page.evaluate(() => document.body.scrollHeight);
    const sectionAfter = await page.evaluate<number | null>(sectionUnder(waitingSection.heading));
    return { before, after, sectionBefore: waitingSection.height, sectionAfter };
}

test.describe('the news section', () => {
    test('is the same height whether or not it has articles to show', async ({ page }) => {
        const seen = await pageMovementWhenNewsArrives(page, []);
        expect(
            seen.sectionAfter,
            `an empty answer changed the section from ${seen.sectionBefore}px to ${seen.sectionAfter}px`,
        ).toBe(seen.sectionBefore);
        expect(
            seen.after - seen.before,
            `an empty answer changed the page length by ${seen.after - seen.before}px`,
        ).toBe(0);
    });

    test('is the same height once its articles arrive', async ({ page }) => {
        const seen = await pageMovementWhenNewsArrives(page, [1, 2, 3, 4].map((n) => article(n)));
        expect(
            seen.sectionAfter,
            `four articles changed the section from ${seen.sectionBefore}px to ${seen.sectionAfter}px`,
        ).toBe(seen.sectionBefore);
        expect(
            seen.after - seen.before,
            `four articles changed the page length by ${seen.after - seen.before}px`,
        ).toBe(0);
    });

    test('is the same height whatever the articles have to say', async ({ page }) => {
        const seen = await pageMovementWhenNewsArrives(page, [1, 2, 3, 4].map((n) => article(n, LONG)));
        expect(
            seen.sectionAfter,
            `long headlines changed the section from ${seen.sectionBefore}px to ${seen.sectionAfter}px`,
        ).toBe(seen.sectionBefore);
    });
});
