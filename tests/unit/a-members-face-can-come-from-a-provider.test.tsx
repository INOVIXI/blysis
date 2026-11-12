/**
 * A member with no picture of their own can be drawn from a provider.
 *
 * Most members never set a picture, and an operator may close member pictures
 * altogether. Both used to mean initials on a colour. A site whose members
 * already have a face somewhere else - a game account, a public profile - had
 * no way to say so: a module now declares a picture service in its manifest,
 * the operator picks one, and every face on the site asks it by the member's
 * name. A picture that does not load is initials, as before.
 *
 * The hosts here are invented on purpose: core names no provider.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { avatarProvidersOf } from "@/core/lib/avatar-providers";
import {
    DEFAULT_FACE_RULES,
    faceRulesFrom,
    memberFaceSources,
    providerFaceSize,
    providerFaceUrl,
} from "@/core/lib/member-face";
import { MemberFaceProvider } from "@/core/components/MemberFaceProvider";
import { MemberAvatar } from "@/core/components/ui/MemberAvatar";

const PATTERN = "https://faces.example.com/head/{name}/{size}";

describe("a provider's address for a member", () => {
    it("puts the name and the size where the pattern says", () => {
        expect(providerFaceUrl(PATTERN, "Steve", 40)).toBe("https://faces.example.com/head/Steve/80");
    });

    it("encodes the name, so a name cannot walk out of its segment", () => {
        expect(providerFaceUrl(PATTERN, "a b/../c?d#e", 40)).toBe(
            "https://faces.example.com/head/a%20b%2F..%2Fc%3Fd%23e/80",
        );
    });

    it("trims the name and has nothing to ask for an empty one", () => {
        expect(providerFaceUrl(PATTERN, "  Alex ", 40)).toBe("https://faces.example.com/head/Alex/80");
        expect(providerFaceUrl(PATTERN, "   ", 40)).toBeNull();
    });

    it("fills every occurrence of a token", () => {
        expect(providerFaceUrl("https://faces.example.com/{name}/{size}/{name}.png?s={size}", "Kim", 20))
            .toBe("https://faces.example.com/Kim/40/Kim.png?s=40");
    });

    it("asks for twice the drawn size, within bounds every service serves", () => {
        expect(providerFaceSize(40)).toBe(80);
        expect(providerFaceSize(3)).toBe(16);
        expect(providerFaceSize(1000)).toBe(512);
        expect(providerFaceSize(24.4)).toBe(49);
        expect(providerFaceSize(Number.NaN)).toBe(80);
    });
});

describe("which picture a member's face is", () => {
    const provider = { ownPictures: true, pattern: PATTERN };

    it("is their own picture while the site allows one", () => {
        expect(memberFaceSources(provider, { name: "Steve", src: "/uploads/me.png", size: 40 }))
            .toEqual(["/uploads/me.png", "https://faces.example.com/head/Steve/80"]);
    });

    it("is the provider's when they have none", () => {
        expect(memberFaceSources(provider, { name: "Steve", src: null, size: 40 }))
            .toEqual(["https://faces.example.com/head/Steve/80"]);
        expect(memberFaceSources(provider, { name: "Steve", src: "  ", size: 40 }))
            .toEqual(["https://faces.example.com/head/Steve/80"]);
    });

    it("is never their own picture when member pictures are off", () => {
        const off = { ownPictures: false, pattern: PATTERN };
        expect(memberFaceSources(off, { name: "Steve", src: "/uploads/me.png", size: 40 }))
            .toEqual(["https://faces.example.com/head/Steve/80"]);
        expect(memberFaceSources({ ownPictures: false, pattern: null }, { name: "Steve", src: "/uploads/me.png", size: 40 }))
            .toEqual([]);
    });

    it("is their own picture or nothing with no provider chosen", () => {
        expect(memberFaceSources(DEFAULT_FACE_RULES, { name: "Steve", src: "/uploads/me.png", size: 40 }))
            .toEqual(["/uploads/me.png"]);
        expect(memberFaceSources(DEFAULT_FACE_RULES, { name: "Steve", size: 40 })).toEqual([]);
    });
});

describe("the rules a site's settings make", () => {
    const providers = [
        { id: "faces.head", module: "faces", labelKey: "faces_head", url: PATTERN, host: "https://faces.example.com" },
    ];

    it("follow the stored policy and the chosen provider", () => {
        expect(faceRulesFrom({ policy: "upload", chosen: "faces.head" }, providers, {}))
            .toEqual({ ownPictures: true, pattern: PATTERN });
        expect(faceRulesFrom({ policy: "off", chosen: "faces.head" }, providers, { faces: true }))
            .toEqual({ ownPictures: false, pattern: PATTERN });
        expect(faceRulesFrom({ policy: "link", chosen: undefined }, providers, {}))
            .toEqual({ ownPictures: true, pattern: null });
    });

    it("draw no provider whose module is switched off, uninstalled or never existed", () => {
        expect(faceRulesFrom({ policy: "off", chosen: "faces.head" }, providers, { faces: false }).pattern).toBeNull();
        expect(faceRulesFrom({ policy: "off", chosen: "gone.head" }, providers, {}).pattern).toBeNull();
        expect(faceRulesFrom({ policy: "off", chosen: "" }, providers, {}).pattern).toBeNull();
        expect(faceRulesFrom({ policy: "off", chosen: 7 }, providers, {}).pattern).toBeNull();
    });
});

/** The least a manifest needs, plus whatever a case adds. */
function manifest(extra: Record<string, unknown>) {
    return {
        id: "faces",
        name: "Faces",
        description: "Faces from somewhere else",
        version: "1.0.0",
        coreVersion: "^5.33.0",
        csp: { "img-src": ["https://faces.example.com"] },
        ...extra,
    };
}

const entry = { id: "head", labelKey: "faces_head", url: PATTERN };

describe("an avatar provider in a manifest", () => {
    it("is accepted with an id, a label and an https pattern naming {name}", () => {
        expect(moduleManifestSchema.safeParse(manifest({ avatarProviders: [entry] })).success).toBe(true);
        expect(moduleManifestSchema.safeParse(manifest({
            avatarProviders: [{ ...entry, url: "https://faces.example.com/h/{name}.png?size={size}" }],
        })).success).toBe(true);
    });

    it("must name the member", () => {
        expect(moduleManifestSchema.safeParse(manifest({
            avatarProviders: [{ ...entry, url: "https://faces.example.com/head/{size}" }],
        })).success).toBe(false);
    });

    it("is refused over plain http, with a token in the host, or with a token core cannot fill", () => {
        for (const url of [
            "http://faces.example.com/head/{name}",
            "https://{name}.example.com/head",
            "https://faces.example.com/head/{uuid}/{name}",
            "https://faces.example.com/head/{name}\" onerror=\"x",
            "javascript:{name}",
        ]) {
            expect(moduleManifestSchema.safeParse(manifest({ avatarProviders: [{ ...entry, url }] })).success, url).toBe(false);
        }
    });

    it("declares its host for the CSP's img-src", () => {
        const undeclared = moduleManifestSchema.safeParse(manifest({ csp: undefined, avatarProviders: [entry] }));
        expect(undeclared.success).toBe(false);
        const elsewhere = moduleManifestSchema.safeParse(manifest({
            csp: { "img-src": ["https://other.example.com"] },
            avatarProviders: [entry],
        }));
        expect(elsewhere.success).toBe(false);
    });

    it("names each provider once", () => {
        expect(moduleManifestSchema.safeParse(manifest({ avatarProviders: [entry, entry] })).success).toBe(false);
    });
});

describe("the providers the installed modules declare", () => {
    it("are collected under the module's id, in a stable order, with their host", () => {
        const loaded = [
            { moduleName: "zeta", manifest: { avatarProviders: [{ id: "b", labelKey: "zb", url: "https://z.example.com/{name}" }] } },
            { moduleName: "alpha", manifest: {} },
            {
                moduleName: "faces",
                manifest: {
                    avatarProviders: [
                        { id: "head", labelKey: "faces_head", url: PATTERN },
                        { id: "body", labelKey: "faces_body", url: "https://body.example.com/{name}/{size}.png" },
                    ],
                },
            },
        ];
        expect(avatarProvidersOf(loaded)).toEqual([
            { id: "faces.body", module: "faces", labelKey: "faces_body", url: "https://body.example.com/{name}/{size}.png", host: "https://body.example.com" },
            { id: "faces.head", module: "faces", labelKey: "faces_head", url: PATTERN, host: "https://faces.example.com" },
            { id: "zeta.b", module: "zeta", labelKey: "zb", url: "https://z.example.com/{name}", host: "https://z.example.com" },
        ]);
    });

    it("are none with nothing installed", () => {
        expect(avatarProvidersOf([])).toEqual([]);
    });
});

describe("a face on the page", () => {
    const image = (container: HTMLElement) => container.querySelector("img");

    it("is the member's own picture outside any provider, as it always was", () => {
        const { container } = render(<MemberAvatar name="Steve" src="/uploads/me.png" />);
        // next/image writes a relative address out against the test's origin.
        expect(new URL(image(container)!.getAttribute("src")!, "http://x").pathname).toBe("/uploads/me.png");
    });

    it("is the provider's picture for a member with none", () => {
        const { container } = render(
            <MemberFaceProvider rules={{ ownPictures: true, pattern: PATTERN }}>
                <MemberAvatar name="Steve" size={32} />
            </MemberFaceProvider>,
        );
        expect(image(container)?.getAttribute("src")).toBe("https://faces.example.com/head/Steve/64");
    });

    it("is not the member's own picture when member pictures are off", () => {
        const { container } = render(
            <MemberFaceProvider rules={{ ownPictures: false, pattern: null }}>
                <MemberAvatar name="Steve Rogers" src="/uploads/me.png" />
            </MemberFaceProvider>,
        );
        expect(image(container)).toBeNull();
        expect(container.textContent).toBe("SR");
    });

    it("falls back from a picture that does not load to the next, then to initials", () => {
        const { container } = render(
            <MemberFaceProvider rules={{ ownPictures: true, pattern: PATTERN }}>
                <MemberAvatar name="Steve Rogers" src="/uploads/gone.png" size={32} />
            </MemberFaceProvider>,
        );
        fireEvent.error(image(container)!);
        expect(image(container)?.getAttribute("src")).toBe("https://faces.example.com/head/Steve%20Rogers/64");
        fireEvent.error(image(container)!);
        expect(image(container)).toBeNull();
        expect(container.textContent).toBe("SR");
    });
});
