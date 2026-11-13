import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * A rejection says why, stays in reach, and can be taken back.
 *
 * Rejecting from the queue used to be a plain "are you sure" that set the
 * row to REJECTED; the post left the screen and nothing ever showed it
 * again. A moderator now picks a reason and may leave a note, the Rejected
 * view lists the post beside both, and from there it can go back to the
 * queue or be approved.
 *
 * The forum is the module that holds the post, because it is installed on
 * every e2e site; the spec turns its topic moderation on, writes a topic,
 * and puts the setting, the topic and any category it made back afterwards.
 */

interface Made {
    origin: string;
    topicId: string;
    title: string;
    categoryId: string | null;
    previousModeration: unknown;
}

async function setUp(page: Page, origin: string): Promise<Made> {
    const request: APIRequestContext = page.request;
    const settings = await (await request.get("/api/v1/settings")).json();
    const previousModeration = settings?.settings?.moderation ?? {};
    const held = await request.patch("/api/v1/settings", {
        headers: { origin },
        data: { moderation: { ...(previousModeration as object), forum_topics: "manual" } },
    });
    expect(held.ok(), "turning topic moderation on").toBe(true);

    const stamp = Date.now().toString(36);
    let categoryId: string | null = null;
    const existing = await (await request.get("/api/v1/forum/categories?scope=admin")).json();
    let useCategory: string | undefined = existing?.categories?.[0]?.id;
    if (!useCategory) {
        const made = await request.post("/api/v1/forum/categories", {
            headers: { origin },
            data: { name: `Moderation ${stamp}`, slug: `moderation-${stamp}` },
        });
        expect(made.ok(), "making a category to post in").toBe(true);
        categoryId = (await made.json()).category.id;
        useCategory = categoryId!;
    }

    const title = `Reason check ${stamp}`;
    const posted = await request.post("/api/v1/forum/topics", {
        headers: { origin },
        data: { title, content: "This topic waits for a moderator to read it.", categoryId: useCategory },
    });
    expect(posted.ok(), "writing the topic").toBe(true);
    const body = await posted.json();
    const topicId: string = body.topic?.id ?? body.id;
    return { origin, topicId, title, categoryId, previousModeration };
}

async function tearDown(page: Page, made: Made) {
    const { origin } = made;
    await page.request.delete(`/api/v1/forum/topics/${made.topicId}`, { headers: { origin } });
    if (made.categoryId) await page.request.delete(`/api/v1/forum/categories/${made.categoryId}`, { headers: { origin } });
    await page.request.patch("/api/v1/settings", { headers: { origin }, data: { moderation: made.previousModeration } });
}

function rowOf(page: Page, title: string) {
    return page.locator(".divide-y > div", { hasText: title });
}

async function reject(page: Page, title: string, note?: string) {
    await rowOf(page, title).getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog", { name: "Reject content" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Reason").selectOption({ label: "Spam" });
    if (note) await dialog.getByLabel("Note (optional)").fill(note);
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(dialog).toBeHidden();
}

test("a rejection says why, stays in reach, and can be taken back", async ({ page, baseURL }) => {
    await login(page);
    const made = await setUp(page, new URL(baseURL!).origin);
    try {
        await page.goto("/en/admin/moderation");
        await expect(rowOf(page, made.title)).toBeVisible();

        await reject(page, made.title, "Links to another server");
        await expect(rowOf(page, made.title)).toHaveCount(0);

        await page.getByRole("tab", { name: "Rejected" }).click();
        const rejected = rowOf(page, made.title);
        await expect(rejected).toBeVisible();
        await expect(rejected.getByText("Reason: Spam")).toBeVisible();
        await expect(rejected.getByText("Note: Links to another server")).toBeVisible();
        await expect(rejected.getByText(/^Rejected by .+ on /)).toBeVisible();

        await rejected.getByRole("button", { name: "Back to queue" }).click();
        await expect(rowOf(page, made.title)).toHaveCount(0);
        await page.getByRole("tab", { name: "Waiting" }).click();
        await expect(rowOf(page, made.title)).toBeVisible();

        await reject(page, made.title);
        await page.getByRole("tab", { name: "Rejected" }).click();
        await rowOf(page, made.title).getByRole("button", { name: "Approve" }).click();
        await expect(rowOf(page, made.title)).toHaveCount(0);

        const topic = await page.request.get(`/api/v1/forum/topics/${made.topicId}`);
        expect(topic.ok(), "the approved topic is readable").toBe(true);
    } finally {
        await tearDown(page, made);
    }
});
