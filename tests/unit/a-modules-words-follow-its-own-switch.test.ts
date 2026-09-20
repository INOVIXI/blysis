// @vitest-environment node
/**
 * A module's strings reach the browser unless an admin turned that module off.
 *
 * `isEnabledIn` says it in so many words: absent means enabled, because a
 * registry entry only exists for a module whose files are installed, so the
 * question is never "is it installed" - only whether somebody said no, and
 * that answer is a stored `false`. The proxy, the navbar, the footer and
 * every slot read it that way.
 *
 * The message catalogue did not. It asked for modules with `enabled: true`
 * and shipped nothing for a module with no row at all, so a module whose
 * screens render perfectly well was served its own keys instead of its words.
 * Measured on 2026-09-20: `/admin/settings/smtp` drew a heading that read
 * `smtpProvider.adm_title`, and the console said the namespace could not be
 * resolved. Every route worked; only the words were missing.
 *
 * Two readings of one absent row is the shape of the bug `module-enabled.ts`
 * was written to end. This is the last reader that had its own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []);

vi.mock("@/core/lib/db", () => ({
    prisma: {
        moduleConfig: { findMany: (args: unknown) => findMany(args) },
        translation: { findMany: async () => [] },
    },
}));
vi.mock("@/core/lib/cache", () => ({
    cacheGet: async () => null,
    cacheSet: async () => {},
    cacheDel: async () => {},
}));
vi.mock("@/core/lib/theme-state", () => ({ activeThemeId: async () => "flat" }));

const { getMessages } = await import("@/core/lib/i18n/translation-service");

/** What the catalogue asked `ModuleConfig` for, on the first call. */
function askedFor(): Record<string, unknown> {
    return (findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> })?.where ?? {};
}

beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
});

describe("the module rows the message catalogue reads", () => {
    it("are the ones an admin switched off, not the ones switched on", async () => {
        await getMessages("en");

        // Asking for `enabled: true` is what excluded a module with no row.
        expect(askedFor()).not.toMatchObject({ enabled: true });
        expect(askedFor()).toMatchObject({ enabled: false });
    });
});

describe("a module nobody has ruled on", () => {
    it("is not among the ones the catalogue leaves out", async () => {
        // Two rows: one module switched off, one absent entirely. Only the
        // first may be excluded, and the query can only exclude what it was
        // handed.
        findMany.mockResolvedValue([{ id: "turned-off" }]);
        // A locale of its own: the catalogue is held per locale for the life
        // of the process, so a second ask for one already built answers from
        // memory and questions nothing.
        await getMessages("tr");

        expect(askedFor()).toEqual({ enabled: false });
    });
});
