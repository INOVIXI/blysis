import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

/**
 * A signed-out visitor was told the site was broken.
 *
 * The market asks what can be handed over, because this module has no idea
 * and a seller must not be offered something nothing can deliver. That
 * endpoint is `openTo: "member"`, so it answers 401 to a reader who is not
 * signed in - correctly, and every time.
 *
 * The board treated any answer that was not ok as a failed read: "we could
 * not check what can be sold at the moment", with a Retry button that asks
 * the same question and gets the same 401 for ever. The listings underneath
 * were drawn perfectly well the whole time.
 *
 * A refusal is not a failure. Somebody who is not signed in cannot sell here,
 * which is a fact about them rather than about the site, and the screen has
 * nothing to apologise for. The alarm belongs to the case it was written for:
 * a reader who *is* signed in and still cannot be told what is sellable.
 */

const session: { value: unknown } = { value: null };

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: session.value }) }));
vi.mock("next-intl", () => ({
    // The key itself, so an assertion reads as the thing being said.
    useTranslations: () => Object.assign((key: string) => key, { has: () => true }),
}));
vi.mock("@/core/sdk/ui", () => ({
    Button: ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
        <button {...rest}>{children}</button>,
    Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CardContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Input: (props: Record<string, unknown>) => <input {...props} />,
    Label: ({ children }: { children?: React.ReactNode }) => <label>{children}</label>,
    LoadFailed: () => <div>LoadFailed</div>,
    NativeSelect: (props: Record<string, unknown>) => <select {...props} />,
    Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
    useConfirm: () => ({ confirm: async () => false }),
    useSiteCurrency: () => ({ format: (n: number) => String(n) }),
}));
vi.mock("@/core/sdk/layout", () => ({
    PageFrame: ({ children }: { children?: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/core/sdk", () => ({ errorMessage: (_d: unknown, fallback: string) => fallback }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }));

async function board() {
    const { ListingBoard } = await import("@/modules/marketplace/components/ListingBoard");
    return render(<ListingBoard initial={[]} />);
}

beforeEach(() => {
    session.value = null;
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
});

afterEach(() => cleanup());

describe("a refusal is not a failure", () => {
    it("says nothing went wrong to a reader who is not signed in", async () => {
        await board();

        /*
         * Let everything the component was going to do happen first. A
         * `waitFor` on an absence passes on its first tick, before any fetch
         * has settled, so it would have passed against the bug this defends.
         * The signed-in case below is what proves the alarm can appear at all.
         */
        await new Promise((settle) => setTimeout(settle, 50));

        expect(screen.queryByText("sellUnavailable")).toBeNull();
    });

    it("does not even ask, because the answer cannot be theirs", async () => {
        await board();

        await waitFor(() => expect(fetch).not.toHaveBeenCalledWith(
            expect.stringContaining("delivery-kinds"),
        ));
    });

    it("still tells a member when the read really did fail", async () => {
        session.value = { user: { id: "u1" } };

        await board();

        await waitFor(() => expect(screen.getByText("sellUnavailable")).toBeTruthy());
    });

    it("offers the form to a member once the kinds arrive", async () => {
        session.value = { user: { id: "u1" } };
        vi.stubGlobal("fetch", vi.fn(async () => new Response(
            JSON.stringify({ kinds: [{ kind: "credits", label: "Credits" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        )));

        await board();

        await waitFor(() => expect(screen.queryByText("sellUnavailable")).toBeNull());
        await waitFor(() => expect(screen.getByText("formTitle")).toBeTruthy());
    });
});
