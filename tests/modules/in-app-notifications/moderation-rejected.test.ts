// @vitest-environment node
/**
 * The author of a rejected post hears about it, unless they asked not to.
 *
 * The notification says only that a post was not published and links to the
 * page that says why. The reason is not copied into it: the notification is
 * stored once, and the page shows the reason in whatever language the author
 * reads it in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const created: Record<string, unknown>[] = [];
let wantsIt = true;

vi.mock("@/core/sdk/server", () => ({
    shouldNotify: async (_user: string, event: string, channel: string) =>
        wantsIt && event === "moderation.item.rejected" && channel === "inapp",
}));
vi.mock("@/modules/in-app-notifications/lib/notifications", () => ({
    createNotification: async (params: Record<string, unknown>) => {
        created.push(params);
    },
}));

const onRejected = (await import("@/modules/in-app-notifications/listeners/moderation-rejected")).default;

const payload = { provider: "forum-post", itemId: "p1", authorId: "u1", decisionId: "d1" };

beforeEach(() => {
    created.length = 0;
    wantsIt = true;
});

describe("a rejection", () => {
    it("tells the author, with a link to why", async () => {
        await onRejected(payload);
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            userId: "u1",
            titleKey: "notif_moderationRejectedTitle",
            messageKey: "notif_moderationRejectedMessage",
            href: "/moderation/forum-post/p1",
        });
    });

    it("tells nobody who switched it off", async () => {
        wantsIt = false;
        await onRejected(payload);
        expect(created).toEqual([]);
    });

    it("does not crash on a payload with no author", async () => {
        await onRejected({ ...payload, authorId: "" });
        expect(created).toEqual([]);
    });
});
