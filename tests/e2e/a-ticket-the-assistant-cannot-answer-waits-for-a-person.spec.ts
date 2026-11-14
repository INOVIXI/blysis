import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * A ticket the support assistant cannot answer waits for a person, who sees
 * why on the ticket and can stop the assistant there.
 *
 * Every module is installed on an e2e site and no AI provider has a key, so
 * every call the assistant makes ends in `no_provider`: the path a fresh site
 * walks before its operator adds one. The department is set to drafts from
 * the settings screen with a single attempt, a ticket is opened in it and
 * answered once by its author from the member's screen, and the round is run
 * through the cron screen's own endpoint rather than waited for. Nothing may
 * reach the member, and staff must see on the ticket that the assistant could
 * not answer.
 *
 * The department, the ticket and the settings are put back afterwards.
 */

const KEYS = ["ai_support_modes", "ai_support_max_attempts"] as const;

test("a ticket the assistant cannot answer waits for a person", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const origin = new URL(baseURL!).origin;
    await login(page);
    const settings = (await (await page.request.get("/api/v1/settings")).json())?.settings ?? {};
    const previous = Object.fromEntries(KEYS.map((key) => [key, settings[key] ?? null]));
    const stamp = Date.now().toString(36);

    const department = await page.request.post("/api/v1/tickets/departments", {
        headers: { origin },
        data: { name: `Assistant check ${stamp}` },
    });
    expect(department.ok(), "making a department").toBe(true);
    const departmentId: string = (await department.json()).id;
    let ticketId: string | null = null;

    try {
        // The settings screen names the department and keeps its mode.
        await page.goto("/en/admin/ai-support/settings");
        await expect(page.getByRole("heading", { name: "AI support settings" })).toBeVisible();
        const mode = page.getByLabel(`Assistant check ${stamp}`);
        await expect(mode).toHaveValue("off");
        await mode.selectOption({ label: "Draft only" });
        await page.getByLabel("Attempts", { exact: true }).fill("1");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Settings saved.")).toBeVisible();
        await page.reload();
        await expect(page.getByLabel(`Assistant check ${stamp}`)).toHaveValue("drafts");

        const opened = await page.request.post("/api/v1/tickets", {
            headers: { origin },
            data: { subject: `Rank missing ${stamp}`, departmentId, message: "I bought a rank and it never arrived." },
        });
        expect(opened.ok(), "opening the ticket").toBe(true);
        ticketId = (await opened.json()).id as string;

        // Its author answers from the member's screen, which sends the text alone.
        await page.goto(`/en/support/${ticketId}`);
        await page.getByPlaceholder("Type your reply...").fill("It has been an hour now.");
        await page.getByRole("button", { name: "Send Reply" }).click();
        await expect(page.getByText("It has been an hour now.")).toBeVisible();

        const ran = await page.request.post(`/api/v1/admin/cron/${encodeURIComponent("ai-support:answer-tickets")}/run`, { headers: { origin } });
        expect(ran.ok(), "running the assistant's round").toBe(true);

        const draft = (await (await page.request.get(`/api/v1/ai-support/tickets/${ticketId}/draft`)).json()).draft;
        expect(draft, "the assistant recorded that it could not answer").toMatchObject({ status: "failed" });

        // Nothing reached the member: the conversation is the two messages it had.
        const thread = await (await page.request.get(`/api/v1/tickets/${ticketId}`)).json();
        expect(thread.messages).toHaveLength(2);
        expect((thread.messages as { byAssistant?: boolean }[]).some((m) => m.byAssistant)).toBe(false);

        // Staff see why on the ticket, and can stop the assistant there and start it again.
        await page.goto(`/en/admin/tickets/${ticketId}`);
        await expect(page.getByText("The assistant could not answer this message.")).toBeVisible();
        await expect(page.getByText("The assistant may answer this ticket.")).toBeVisible();
        await page.getByRole("button", { name: "Stop the assistant" }).click();
        await expect(page.getByText("The assistant is stopped on this ticket.")).toBeVisible();
        await page.getByRole("button", { name: "Let the assistant answer" }).click();
        await expect(page.getByText("The assistant may answer this ticket.")).toBeVisible();

        // And the record shows it.
        await page.goto("/en/admin/ai-support");
        await expect(page.getByRole("heading", { name: "AI support" })).toBeVisible();
        await expect(page.getByRole("listitem").getByText("Could not answer").first()).toBeVisible();
    } finally {
        if (ticketId) await page.request.delete(`/api/v1/tickets/${ticketId}`, { headers: { origin } });
        await page.request.delete(`/api/v1/tickets/departments/${departmentId}`, { headers: { origin } });
        await page.request.patch("/api/v1/settings", { headers: { origin }, data: previous });
    }
});
