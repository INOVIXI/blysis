// @vitest-environment jsdom
/**
 * A field an admin empties is saved empty.
 *
 * The form sent a blank field as nothing at all, which is right on a create
 * and wrong on an edit: a PATCH leaves alone what it is not sent, so a
 * server's description or a picture an admin deleted came back on the next
 * load, on every screen built from this shell, after a "saved" toast. A
 * field that held something and was emptied is now sent as its default, or
 * `null` when it has none (a wheel prize's colour has one); a field
 * that was already empty is still left out, so a route that has never been
 * sent a `null` for it is not sent one now.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("form=1") }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/servers",
    useSearchParams: () => new URLSearchParams("form=1"),
}));

const sent: { method: string; body: Record<string, unknown> }[] = [];
vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method) {
        sent.push({ method: init.method, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ server: { id: "1" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ servers: [{ id: "1", name: "Survival", description: "One world.", motd: null, color: "#ff0000" }] }), { status: 200 });
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { AdminCrudPage } = await import("@/core/components/admin/AdminCrudPage");

describe("an edited row", () => {
    it("is sent a field the admin emptied as null, and an empty one it never had not at all", async () => {
        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <AdminCrudPage
                    title="Servers" subtitle="" apiPath="/api/v1/servers" listKey="servers" displayField="name"
                    fields={[
                        { key: "name", label: "Name", required: true },
                        { key: "description", label: "Description", type: "textarea" },
                        { key: "motd", label: "Message" },
                        { key: "color", label: "Colour", defaultValue: "#3b82f6" },
                    ]}
                />
            </NextIntlClientProvider>,
        );
        const description = await screen.findByDisplayValue("One world.");
        fireEvent.change(description, { target: { value: "" } });
        fireEvent.change(screen.getByDisplayValue("#ff0000"), { target: { value: "" } });
        fireEvent.submit(description.closest("form") as HTMLFormElement);
        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0].method).toBe("PATCH");
        expect(sent[0].body).toMatchObject({ name: "Survival", description: null, color: "#3b82f6" });
        expect("motd" in sent[0].body).toBe(false);
    });
});
