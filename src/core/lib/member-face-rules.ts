/**
 * The face rules for this site, read on the server for the root layout.
 *
 * Two settings on every page render, so they go through the cache with the
 * same lifetime as the public settings, and the settings endpoint drops the
 * entry on save. Which modules are switched on is not cached here: the layout
 * already holds that map, and a provider whose module is turned off stops
 * being drawn on the next page rather than when the entry expires.
 */
import { cached } from "@/core/lib/cache";
import { readSettingValues } from "@/core/lib/setting-values";
import { SETTINGS_CACHE, getDurationMs } from "@/core/lib/security-settings";
import { MEMBER_AVATAR_UPLOADS_KEY } from "@/core/lib/member-uploads";
import { DEFAULT_FACE_RULES, MEMBER_AVATAR_PROVIDER_KEY, faceRulesFrom, type MemberFaceRules } from "@/core/lib/member-face";
import { ModuleAvatarProviders } from "@/core/generated/module-data";

export const MEMBER_FACE_CACHE_KEY = "member-face";

export async function readMemberFaceRules(moduleStates: Record<string, boolean>): Promise<MemberFaceRules> {
    try {
        const ttlMs = await getDurationMs(SETTINGS_CACHE);
        const stored = await cached(MEMBER_FACE_CACHE_KEY, ttlMs, async () => {
            const values = await readSettingValues([MEMBER_AVATAR_UPLOADS_KEY, MEMBER_AVATAR_PROVIDER_KEY]);
            return {
                policy: values[MEMBER_AVATAR_UPLOADS_KEY] ?? null,
                chosen: values[MEMBER_AVATAR_PROVIDER_KEY] ?? null,
            };
        });
        return faceRulesFrom(stored, ModuleAvatarProviders, moduleStates);
    } catch {
        // A database blip draws faces as they were drawn before there were
        // rules, rather than taking the whole layout down with it.
        return DEFAULT_FACE_RULES;
    }
}
