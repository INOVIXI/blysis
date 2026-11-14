import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * A kind set to review waits for the reviewer, and a reviewer that cannot
 * decide leaves the post to a person, where the admin can see why and take
 * it from there.
 *
 * Every module is installed on an e2e site and no AI provider has a key, so
 * the AI reviewer is on and every call it makes ends in `no_provider`. That is
 * the path a fresh site walks before its operator adds a key: the post must
 * stay unpublished, the log must say the reviewer could not decide, and the
 * admin must be able to read the post and approve it from there. The round is
 * run through the cron screen's own endpoint rather than waited for.
 *
 * The forum holds the post, as in the rejection spec; the setting, the topic
 * and any category made are put back afterwards.
 */

interface Made {
    origin: string;
    topicId: string;
    title: string;
    categoryId: string | null;
    previousModeration: unknown;
}

async function writeTopic(page: Page, origin: string, previousModeration: unknown): Promise<Made> {
    const request = page.request;
    const stamp = Date.now().toString(36);
    let categoryId: string | null = null;
    const existing = await (await request.get("/api/v1/forum/categories?scope=admin")).json();
    let useCategory: string | undefined = existing?.categories?.[0]?.id;
    if (!useCategory) {
        const made = await request.post("/api/v1/forum/categories", {
            headers: { origin },
            data: { name: `Review ${stamp}`, slug: `review-${stamp}` },
        });
        expect(made.ok(), "making a category to post in").toBe(true);
        categoryId = (await made.json()).category.id;
        useCategory = categoryId!;
    }
    const title = `Reviewer check ${stamp}`;
    const posted = await request.post("/api/v1/forum/topics", {
        headers: { origin },
        data: { title, content: "This topic waits for the reviewer to read it.", categoryId: useCategory },
    });
    expect(posted.ok(), "writing the topic").toBe(true);
    const body = await posted.json();
    return { origin, topicId: body.topic?.id ?? body.id, title, categoryId, previousModeration };
}

async function tearDown(page: Page, made: Made) {
    const { origin } = made;
    await page.request.delete(`/api/v1/forum/topics/${made.topicId}`, { headers: { origin } });
    if (made.categoryId) await page.request.delete(`/api/v1/forum/categories/${made.categoryId}`, { headers: { origin } });
    await page.request.patch("/api/v1/settings", { headers: { origin }, data: { moderation: made.previousModeration } });
}

test("a reviewer that cannot decide leaves the post to a person", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const origin = new URL(baseURL!).origin;
    await login(page);
    const settings = await (await page.request.get("/api/v1/settings")).json();
    const previousModeration = settings?.settings?.moderation ?? {};

    // The settings screen offers the reviewer by name and keeps the choice.
    await page.goto("/en/admin/settings/moderation");
    const mode = page.getByLabel(/^What happens to new forum topics$/i);
    await expect(mode).toBeVisible();
    await mode.selectOption({ label: "Reviewed by AI moderation" });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Moderation settings saved")).toBeVisible();

    let made: Made | null = null;
    try {
        made = await writeTopic(page, origin, previousModeration);
        await page.reload();
        await expect(page.getByLabel(/^What happens to new forum topics$/i)).toHaveValue("review");

        const ran = await page.request.post(`/api/v1/admin/cron/${encodeURIComponent("core:moderation-review")}/run`, { headers: { origin } });
        expect(ran.ok(), "running the review round").toBe(true);

        // Nothing could decide, so the topic still waits.
        const stillWaiting = await (await page.request.get("/api/v1/admin/moderation?type=forum-topic")).json();
        expect((stillWaiting.items as { id: string }[]).some((i) => i.id === made!.topicId), "the topic still waits").toBe(true);

        const log = await (await page.request.get("/api/v1/ai-moderation/admin/reviews?applied=error&kind=forum-topic")).json();
        const review = (log.reviews as { id: string; itemId: string }[]).find((r) => r.itemId === made!.topicId);
        expect(review, "the reviewer recorded that it could not decide").toBeTruthy();

        await page.goto("/en/admin/ai-moderation?applied=error");
        await expect(page.getByRole("heading", { name: "AI Moderation" })).toBeVisible();
        await expect(page.getByText("Could not decide").first()).toBeVisible();

        await page.goto(`/en/admin/ai-moderation/${review!.id}`);
        await expect(page.getByText(made.title)).toBeVisible();
        await expect(page.getByText("This topic waits for the reviewer to read it.")).toBeVisible();
        await expect(page.getByText("Now: waiting")).toBeVisible();
        await expect(page.getByText(/so this post waits for a person/)).toBeVisible();

        await page.getByRole("button", { name: "Approve" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Approve" }).click();
        await expect(page.getByText("Now: published")).toBeVisible();

        const approved = await page.request.get(`/api/v1/forum/topics/${made.topicId}`);
        expect(approved.ok(), "the approved topic is readable").toBe(true);

        // The way in to everything the reviewer is told.
        await page.goto("/en/admin/ai-moderation/settings");
        await expect(page.getByRole("heading", { name: "AI Moderation Settings" })).toBeVisible();
        await expect(page.getByLabel("Site rules")).toBeVisible();
    } finally {
        if (made) await tearDown(page, made);
        else await page.request.patch("/api/v1/settings", { headers: { origin }, data: { moderation: previousModeration } });
    }
});
