/**
 * A choice in a setting is named in the reader's language.
 *
 * A field's own label already had a `labelKey`, but the options of a select
 * had only `label`, typed once in English by whoever wrote the manifest. A
 * Turkish operator read a Turkish question over English answers. An option
 * now carries a `labelKey` too, resolved in the `admin` namespace like the
 * field's, with `label` kept as the fallback for a manifest that names none.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { settingFieldSchema } from "@/core/lib/theme-manifest-schema";
import { SelectField } from "@/core/components/admin/theme-customizer/fields/SelectField";

const select = {
    type: "select" as const,
    default: "grid",
    options: [
        { value: "grid", label: "Grid", labelKey: "blocks_sample_grid" },
        { value: "list", label: "List" },
    ],
};

describe("a select option", () => {
    it("may name a translation key beside its label", () => {
        const parsed = settingFieldSchema.safeParse(select);
        expect(parsed.success).toBe(true);
        if (parsed.success && parsed.data.type === "select") {
            expect(parsed.data.options[0].labelKey).toBe("blocks_sample_grid");
        }
    });

    it("refuses a key that is not one", () => {
        const parsed = settingFieldSchema.safeParse({ ...select, options: [{ value: "grid", label: "Grid", labelKey: "a b" }] });
        expect(parsed.success).toBe(false);
    });

    it("is drawn in the reader's language, and by its label without a key", () => {
        render(
            <NextIntlClientProvider locale="tr" messages={{ admin: { blocks_sample_grid: "Izgara" } }}>
                <SelectField def={select} value="grid" onChange={() => {}} isDefault />
            </NextIntlClientProvider>,
        );
        expect(screen.getByRole("option", { name: "Izgara" })).toBeTruthy();
        expect(screen.getByRole("option", { name: "List" })).toBeTruthy();
    });
});
