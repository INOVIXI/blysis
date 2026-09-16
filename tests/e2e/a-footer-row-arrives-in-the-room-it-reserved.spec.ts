/**
 * A footer control that arrives late arrives in room already held for it.
 *
 * The currency picker reads `/api/v1/currency` on mount and rendered nothing
 * until the answer came back, so the footer's settings column grew by one row
 * once it did - and the footer is on every page on the site.
 *
 * Measured on a production build at 1280px: `/tr/forum` was 2791px at load
 * and 2830px four seconds later, and the only elements whose height changed
 * were that column and its wrapper, both by 32px.
 *
 * The first version of this spec held the answer back and compared the page
 * either side of releasing it, and it passed while the page still moved: with
 * the picker delayed, something else late had already pushed the document to
 * its settled height by the time the "before" reading was taken, so the
 * reading measured a page that had finished moving. A load-to-settled reading
 * of the real page has no such window to fall into.
 */
import { test, expect } from '@playwright/test';

/** Long enough for everything on the page to have arrived. */
const SETTLE_MS = 4000;

test('the footer is the height it will be, from the first paint', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/tr/forum', { waitUntil: 'load' });

    const footer = () => page.evaluate(
        () => Math.round(document.querySelector('footer')?.getBoundingClientRect().height ?? -1),
    );
    const document_ = () => page.evaluate(() => document.body.scrollHeight);

    const footerAtLoad = await footer();
    const pageAtLoad = await document_();
    await page.waitForTimeout(SETTLE_MS);

    expect(footerAtLoad, 'no footer was found to measure').toBeGreaterThan(0);
    expect(
        (await footer()) - footerAtLoad,
        'the footer grew after the page had loaded',
    ).toBe(0);

    /*
     * The document is measured too, and only reported. It still grows once
     * after load and it is not this control: bisected on a production build,
     * the jump lands at +934ms, immediately after `/api/v1/announcements`
     * answers, and the strip appears above the navbar and pushes everything
     * under it down.
     *
     * Reserving room for a strip most loads do not have would be worse than
     * the shift, so the fix is to write it on the server - and that is
     * blocked on a module-contract decision. `SlotContentRegistry` is one
     * generated object shared by the client `Slot` and by `ServerSlot`, so a
     * server-only component in it pulls Prisma into the browser bundle;
     * measured, the build fails with "Can't resolve 'fs/promises'". Splitting
     * it needs a `server: true` on a manifest's `slotContents` and a second
     * emitted registry, which changes what a module may declare.
     */
    const documentGrew = (await document_()) - pageAtLoad;
    if (documentGrew !== 0) {
        console.log(`the page still grows ${documentGrew}px after load; see the note above`);
    }
});
