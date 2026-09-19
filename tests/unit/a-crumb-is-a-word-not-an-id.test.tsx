// @vitest-environment jsdom
/**
 * A breadcrumb names a place. An id is not a place.
 *
 * The trail is built from the address, and its last resort for a segment it
 * has no name for is to titlecase it - which is right for `payments` and
 * absurd for a cuid. On every admin screen that edits one record the reader
 * was shown "Talepler > Cmu34gnnk00j5v2titt9zcr61": twenty-five characters of
 * database key, capitalised, sitting in the site's chrome as though it were a
 * section of the panel.
 *
 * Nine admin routes carry a dynamic segment, and the ones that carry an id
 * are all of them bar the theme's setting group.
 *
 * Dropping it is the answer rather than naming it. The breadcrumb is built
 * from the URL and knows nothing about the record; the page's own heading
 * already says which ticket this is, three lines below. A trail that stops at
 * "Tickets" is a trail that is true and useful - it is where Back goes.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const pathname = vi.fn(() => "/admin/tickets/cmu34gnnk00j5v2titt9zcr61");

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
    usePathname: () => pathname(),
}));
vi.mock("@/core/hooks/useAdminNav", () => ({ useAdminNav: () => [] }));
vi.mock("@/core/lib/admin-nav-groups", () => ({ navLabels: () => new Map() }));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const { AdminBreadcrumb } = await import("@/core/components/admin/AdminBreadcrumb");

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <AdminBreadcrumb />
        </NextIntlClientProvider>,
    );
}

describe("the admin breadcrumb", () => {
    it("does not print a record's id at the reader", () => {
        pathname.mockReturnValue("/admin/tickets/cmu34gnnk00j5v2titt9zcr61");
        const { container } = draw();
        expect(container.textContent).not.toMatch(/cmu34gnnk/i);
    });

    it("still names the section the record belongs to", () => {
        pathname.mockReturnValue("/admin/tickets/cmu34gnnk00j5v2titt9zcr61");
        draw();
        expect(screen.getByText("Tickets")).toBeTruthy();
    });

    it("keeps what comes after an id, because that is a place", () => {
        // `/admin/store/products/<id>/edit` reads "Products > Edit".
        pathname.mockReturnValue("/admin/store/products/cmu34gmv300cav2ti9j2xwglp/edit");
        const { container } = draw();
        expect(container.textContent).not.toMatch(/cmu34gmv/i);
        expect(screen.getByText("Edit")).toBeTruthy();
    });

    it("leaves a word alone, however unusual", () => {
        // The rule is about shape, not length: `rate-limits` is a slug a
        // person chose and `crumb_` or the sidebar may yet name it.
        pathname.mockReturnValue("/admin/settings/rate-limits");
        const { container } = draw();
        expect(container.textContent).toContain("Rate Limits");
    });

    it("leaves a numeric segment alone, which is a page or an entry number", () => {
        pathname.mockReturnValue("/admin/changelog/42");
        const { container } = draw();
        expect(container.textContent).toContain("42");
    });
});
