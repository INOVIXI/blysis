// @vitest-environment jsdom
/**
 * The panel's two form shells let a module declare a field the admin writes
 * once per language.
 *
 * `AdminCrudPage` keeps the original in the column it always sent and reads
 * the languages from the row's `translations`, sending them back beside the
 * originals, so an endpoint saves them with `saveContentTranslations`.
 * `SettingsForm` stores the value in the setting as phase one's shape.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/notices",
    useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/core/hooks/useSiteSettings", () => ({
    useSiteSettings: () => ({ settings: { site_languages: ["tr", "en", "de"], default_locale: "tr" }, loaded: true }),
}));

const search = { value: "form=n1" };
const sent: { url: string; method: string; body: Record<string, unknown> }[] = [];
let listed: Record<string, unknown> = {};

vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) {
        sent.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response(JSON.stringify(listed), { status: 200 });
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { AdminCrudPage } = await import("@/core/components/admin/AdminCrudPage");
const { SettingsForm } = await import("@/core/components/admin/SettingsForm");

function wrap(node: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={MESSAGES}>{node}</NextIntlClientProvider>);
}

const FIELDS = [
    { key: "title", label: "Title", type: "translatable" as const, required: true },
    { key: "content", label: "Content", type: "translatableTextarea" as const },
    { key: "body", label: "Body", type: "translatableRichtext" as const },
    { key: "link", label: "Link" },
];

beforeEach(() => {
    sent.length = 0;
    search.value = "form=n1";
    listed = {
        notices: [{
            id: "n1", title: "Kurallar", content: "Kural metni", body: "**Kalın**", link: "/rules",
            translations: { title: { en: "Rules" }, body: { de: "**Fett**" } },
        }],
    };
});

describe("a record's editor", () => {
    it("shows the original in the column's box and each stored language beneath it", async () => {
        wrap(<AdminCrudPage title="Notices" subtitle="" apiPath="/api/v1/notices" listKey="notices" displayField="title" fields={FIELDS} />);
        const title = await screen.findByDisplayValue("Kurallar");
        expect(screen.getByRole("textbox", { name: "Title" })).toBe(title);
        fireEvent.click(screen.getAllByRole("button", { name: /1 of 2/ })[0]);
        expect((screen.getByRole("textbox", { name: "Title, English" }) as HTMLInputElement).value).toBe("Rules");
    });

    it("sends the original as the column and every translatable field's languages beside it", async () => {
        wrap(<AdminCrudPage title="Notices" subtitle="" apiPath="/api/v1/notices" listKey="notices" displayField="title" fields={FIELDS} />);
        const title = await screen.findByDisplayValue("Kurallar");
        fireEvent.change(title, { target: { value: "Site kuralları" } });
        fireEvent.click(screen.getAllByRole("button", { name: /0 of 2/ })[0]);
        fireEvent.click(screen.getAllByRole("button", { name: /^Deutsch/ })[0]);
        fireEvent.change(screen.getByRole("textbox", { name: "Content, Deutsch" }), { target: { value: "Regeltext" } });
        fireEvent.submit(title.closest("form") as HTMLFormElement);

        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]).toMatchObject({ url: "/api/v1/notices/n1", method: "PATCH" });
        expect(sent[0].body).toMatchObject({ title: "Site kuralları", content: "Kural metni", body: "**Kalın**", link: "/rules" });
        expect(sent[0].body.translations).toEqual({
            title: { en: "Rules" },
            content: { de: "Regeltext" },
            body: { de: "**Fett**" },
        });
    });

    it("sends a cleared language as a field with nothing in it, which removes it", async () => {
        wrap(<AdminCrudPage title="Notices" subtitle="" apiPath="/api/v1/notices" listKey="notices" displayField="title" fields={FIELDS} />);
        const title = await screen.findByDisplayValue("Kurallar");
        fireEvent.click(screen.getAllByRole("button", { name: /1 of 2/ })[0]);
        fireEvent.change(screen.getByRole("textbox", { name: "Title, English" }), { target: { value: "" } });
        fireEvent.submit(title.closest("form") as HTMLFormElement);
        await waitFor(() => expect(sent).toHaveLength(1));
        expect((sent[0].body.translations as Record<string, unknown>).title).toEqual({});
    });

    it("writes a rich body's languages in the site's editor", async () => {
        wrap(<AdminCrudPage title="Notices" subtitle="" apiPath="/api/v1/notices" listKey="notices" displayField="title" fields={FIELDS} />);
        await screen.findByDisplayValue("Kurallar");
        expect((screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).value).toBe("**Kalın**");
        fireEvent.click(screen.getAllByRole("button", { name: /1 of 2/ })[1]);
        fireEvent.click(screen.getAllByRole("button", { name: /^Deutsch/ })[0]);
        expect((screen.getByRole("textbox", { name: "Body, Deutsch" }) as HTMLTextAreaElement).value).toBe("**Fett**");
    });

    it("starts a new record with no languages and still says so on the create", async () => {
        search.value = "form=new";
        wrap(<AdminCrudPage title="Notices" subtitle="" apiPath="/api/v1/notices" listKey="notices" displayField="title" fields={FIELDS} />);
        const title = await screen.findByRole("textbox", { name: "Title" });
        fireEvent.change(title, { target: { value: "Yeni" } });
        fireEvent.submit(title.closest("form") as HTMLFormElement);
        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]).toMatchObject({ url: "/api/v1/notices", method: "POST" });
        expect(sent[0].body.translations).toEqual({ title: {}, content: {}, body: {} });
    });

    it("sends no translations at all from a screen that declares none", async () => {
        wrap(<AdminCrudPage title="Notices" subtitle="" apiPath="/api/v1/notices" listKey="notices" displayField="title" fields={[{ key: "title", label: "Title" }]} />);
        const title = await screen.findByDisplayValue("Kurallar");
        fireEvent.submit(title.closest("form") as HTMLFormElement);
        await waitFor(() => expect(sent).toHaveLength(1));
        expect("translations" in sent[0].body).toBe(false);
    });
});

describe("a settings screen", () => {
    it("reads either shape back and saves the value in the shape textFor reads", async () => {
        listed = { settings: { goal_title: { default: "Aylık hedef", en: "Monthly goal" }, goal_line: "Bir satır" } };
        wrap(
            <SettingsForm
                title="Goal" subtitle=""
                fields={[
                    { key: "goal_title", label: "Goal title", type: "translatable" },
                    { key: "goal_line", label: "Goal line", type: "translatableTextarea" },
                ]}
            />,
        );
        const title = await screen.findByDisplayValue("Aylık hedef");
        expect(screen.getByRole("textbox", { name: "Goal title" })).toBe(title);
        fireEvent.click(screen.getAllByRole("button", { name: /0 of 2/ })[0]);
        fireEvent.click(screen.getAllByRole("button", { name: /^Deutsch/ })[0]);
        fireEvent.change(screen.getByRole("textbox", { name: "Goal line, Deutsch" }), { target: { value: "Eine Zeile" } });
        fireEvent.submit(title.closest("form") as HTMLFormElement);

        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0].body).toEqual({
            goal_title: { default: "Aylık hedef", en: "Monthly goal" },
            goal_line: { default: "Bir satır", de: "Eine Zeile" },
        });
    });
});
