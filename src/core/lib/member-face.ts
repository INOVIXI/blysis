/**
 * Which picture a member's face is drawn from.
 *
 * Most members never set a picture, and an operator may close member pictures
 * altogether, so for most faces on a site the answer used to be initials. A
 * site whose members already have a face elsewhere - an account on another
 * service under the same name, say - can now name a picture service: a
 * module declares it (`avatarProviders` in the manifest), the operator picks
 * it next to the
 * member picture setting, and a member without a picture of their own is
 * drawn from it by name.
 *
 * Pure, importing only two import-free readers, because
 * `MemberAvatar` is a client component and decides with this in the browser:
 * see `member-uploads.ts` for what a database import here would cost.
 * `tests/unit/a-members-face-can-come-from-a-provider.test.tsx` holds the
 * rules.
 */
import { memberAvatarsAllowed } from "@/core/lib/member-uploads";
import { isEnabledIn } from "@/core/lib/module-enabled";

/** The setting that holds the chosen provider's id, `<module>.<provider>`. */
export const MEMBER_AVATAR_PROVIDER_KEY = "member_avatar_provider";

/** What the page needs to know to draw any face. */
export interface MemberFaceRules {
    /** Whether a member's own picture may be drawn at all. */
    ownPictures: boolean;
    /** The chosen provider's address, with `{name}` and `{size}`, or null. */
    pattern: string | null;
}

/** A site that has said nothing: own pictures, no provider. */
export const DEFAULT_FACE_RULES: MemberFaceRules = { ownPictures: true, pattern: null };

/** A provider as the registry lists it. */
export interface AvatarProviderEntry {
    /** `<module>.<provider>`, which is what the setting stores. */
    id: string;
    module: string;
    labelKey: string;
    url: string;
    /** The origin the pictures come from, as the manifest declared it for the CSP. */
    host: string;
}

/**
 * The size to ask a provider for.
 *
 * Twice what is drawn, so a face is sharp on a high-density screen, and
 * within 16 to 512, which every service listed so far serves; one that is
 * asked outside its range answers with an error, and the face would be
 * initials for a reason nobody could see.
 */
export function providerFaceSize(size: number): number {
    const wanted = Number.isFinite(size) ? Math.round(size * 2) : 80;
    return Math.min(512, Math.max(16, wanted));
}

/**
 * A provider's address for one member, or null when there is no name to ask
 * by. The name is encoded: it is whatever the member chose, and a slash or a
 * question mark in it would otherwise ask the service something else.
 */
export function providerFaceUrl(pattern: string, name: string, size: number): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    return pattern
        .replaceAll("{name}", encodeURIComponent(trimmed))
        .replaceAll("{size}", String(providerFaceSize(size)));
}

/**
 * The pictures to try for a face, in order; initials when none loads.
 *
 * The member's own first, while the site allows one, then the provider's. A
 * picture that fails to load is skipped for the next, so a dead link a member
 * once pasted still ends in a face rather than a broken image.
 */
export function memberFaceSources(
    rules: MemberFaceRules,
    member: { name: string; src?: string | null; size: number },
): string[] {
    const out: string[] = [];
    const own = member.src?.trim();
    if (rules.ownPictures && own) out.push(own);
    if (rules.pattern) {
        const asked = providerFaceUrl(rules.pattern, member.name ?? "", member.size);
        if (asked) out.push(asked);
    }
    return out;
}

/**
 * The rules from what is stored, against what is installed and switched on.
 *
 * A provider whose module was switched off or removed is no provider: its
 * id stays in the setting, so switching the module back on brings the faces
 * back without the operator choosing again.
 */
export function faceRulesFrom(
    stored: { policy: unknown; chosen: unknown },
    providers: readonly AvatarProviderEntry[],
    moduleStates: Record<string, boolean>,
): MemberFaceRules {
    const chosen = typeof stored.chosen === "string" ? stored.chosen : "";
    const provider = chosen
        ? providers.find((p) => p.id === chosen && isEnabledIn(moduleStates, p.module))
        : undefined;
    return {
        ownPictures: memberAvatarsAllowed(stored.policy),
        pattern: provider?.url ?? null,
    };
}
