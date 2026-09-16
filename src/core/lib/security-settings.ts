/**
 * Admin-tunable auth settings.
 *
 * These live in `Setting` and are edited on Admin > Settings > General. Each
 * one is clamped here rather than at the form, because the form is not the only
 * writer - the settings API accepts any number, and a stored row survives a UI
 * change.
 *
 * The password minimum is deliberately one-directional: an admin can require
 * longer passwords than the built-in policy, never shorter. A control that
 * could silently weaken every password check is worse than no control.
 */

import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "./constants";
import { prisma } from "./db";
import { DEFAULT_ALGORITHM, isHashAlgorithm, type HashAlgorithm } from "./hash-algorithms";
import { PASSWORD_POLICY, checkPasswordPolicy, type PasswordCheck } from "./password-policy";
import {
    DEFAULT_USERNAME_RULE,
    isUsernameRule,
    type RegistrationCaps,
    type UsernameRule,
} from "./registration-rules";

const SETTING_KEYS = {
    passwordMinLength: "password_min_length",
    passwordResetExpiryMinutes: "password_reset_expiry_minutes",
    emailVerifyExpiryHours: "email_verify_expiry_hours",
    settingsCacheSeconds: "settings_cache_seconds",
    maxLoginAttempts: "max_login_attempts",
    passwordHashAlgorithm: "password_hash_algorithm",
    usernameRule: "username_rule",
    usernameMinLength: "username_min_length",
    registrationDailyCap: "registration_daily_cap",
    registrationTotalCap: "registration_total_cap",
} as const;

export interface BoundedSetting {
    key: string;
    /** Used when the row is missing or unusable. */
    defaultValue: number;
    min: number;
    max: number;
}

export interface DurationSetting extends BoundedSetting {
    /** Milliseconds per unit, for converting the stored value. */
    unitMs: number;
}

/** Minutes. One hour by default; anything under five is unusable in practice. */
export const PASSWORD_RESET_EXPIRY: DurationSetting = {
    key: SETTING_KEYS.passwordResetExpiryMinutes,
    defaultValue: 60,
    min: 5,
    max: 1440,
    unitMs: 60_000,
};

/** Hours. A day by default, capped at a week. */
export const EMAIL_VERIFY_EXPIRY: DurationSetting = {
    key: SETTING_KEYS.emailVerifyExpiryHours,
    defaultValue: 24,
    min: 1,
    max: 168,
    unitMs: 3_600_000,
};

/** Seconds the client may reuse a fetched settings payload. */
export const SETTINGS_CACHE: DurationSetting = {
    key: SETTING_KEYS.settingsCacheSeconds,
    defaultValue: 60,
    min: 5,
    max: 3600,
    unitMs: 1000,
};

/**
 * Failed password attempts before the account locks, as a count rather than a
 * duration.
 *
 * The environment variable is the install's default - it is what a Docker
 * deployment sets once - and the admin screen overrides it per site. The
 * module that offers this field has done so since it shipped and nothing read
 * the row, so an operator who set it to 3 still got 10.
 *
 * The floor is 3 rather than 1: a control that locks an account on the first
 * typo is a denial-of-service an attacker can aim at any account whose
 * username they know.
 */
export const MAX_LOGIN_ATTEMPTS: BoundedSetting = {
    key: SETTING_KEYS.maxLoginAttempts,
    defaultValue: (() => {
        const raw = Number(process.env.ACCOUNT_LOCKOUT_ATTEMPTS);
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
    })(),
    min: 3,
    max: 100,
};

/**
 * How short a username an operator will accept, at or above core's own floor.
 * The ceiling is core's, because a name longer than the column advertises is
 * not something a setting should be able to promise.
 */
const USERNAME_MIN: BoundedSetting = {
    key: SETTING_KEYS.usernameMinLength,
    defaultValue: USERNAME_MIN_LENGTH,
    min: USERNAME_MIN_LENGTH,
    max: USERNAME_MAX_LENGTH,
};

/**
 * New accounts a day, and accounts in total. Zero is off in both, so the max
 * is a number nobody reaches rather than a number that means "unlimited".
 */
const REGISTRATION_DAILY_CAP: BoundedSetting = {
    key: SETTING_KEYS.registrationDailyCap,
    defaultValue: 0,
    min: 0,
    max: 1_000_000,
};

const REGISTRATION_TOTAL_CAP: BoundedSetting = {
    key: SETTING_KEYS.registrationTotalCap,
    defaultValue: 0,
    min: 0,
    max: 100_000_000,
};

function toNumber(raw: unknown): number | null {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (typeof raw === "string" && raw.trim()) {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function clampBounded(raw: unknown, setting: BoundedSetting): number {
    const n = toNumber(raw);
    if (n === null) return setting.defaultValue;
    return Math.min(setting.max, Math.max(setting.min, Math.floor(n)));
}

export function clampDuration(raw: unknown, setting: DurationSetting): number {
    return clampBounded(raw, setting);
}

export function clampMinPasswordLength(raw: unknown): number {
    const n = toNumber(raw);
    if (n === null) return PASSWORD_POLICY.MIN_LENGTH;
    return Math.min(PASSWORD_POLICY.MAX_LENGTH, Math.max(PASSWORD_POLICY.MIN_LENGTH, Math.floor(n)));
}

async function readSetting(key: string): Promise<unknown> {
    try {
        const row = await prisma.setting.findUnique({ where: { key } });
        return row?.value ?? null;
    } catch {
        // A settings read must never take down a sign-up or a reset.
        return null;
    }
}

async function getPasswordMinLength(): Promise<number> {
    return clampMinPasswordLength(await readSetting(SETTING_KEYS.passwordMinLength));
}

export async function getDurationMs(setting: DurationSetting): Promise<number> {
    return clampDuration(await readSetting(setting.key), setting) * setting.unitMs;
}

export async function getBounded(setting: BoundedSetting): Promise<number> {
    return clampBounded(await readSetting(setting.key), setting);
}

/**
 * Full password check: the built-in policy plus the admin's minimum length.
 * Every flow that accepts a new password goes through this.
 */
export async function enforcePasswordPolicy(password: unknown): Promise<PasswordCheck> {
    const base = checkPasswordPolicy(password);
    if (!base.ok) return base;

    const min = await getPasswordMinLength();
    if (typeof password === "string" && password.length < min) {
        return { ok: false, reason: "too_short", message: `Password must be at least ${min} characters` };
    }
    return { ok: true };
}

/**
 * Which algorithm the next hash is made with.
 *
 * A row naming anything else - a typo, or an algorithm a future version
 * dropped - reads as the default rather than throwing, because a settings row
 * is not a reason for nobody to be able to register. Nothing here rewrites an
 * existing hash: see `password-hash.ts` for why that happens at a login.
 */
export async function getHashAlgorithm(): Promise<HashAlgorithm> {
    const raw = await readSetting(SETTING_KEYS.passwordHashAlgorithm);
    return isHashAlgorithm(raw) ? raw : DEFAULT_ALGORITHM;
}

/** The username rule an operator picked, or core's own. */
export async function getUsernameRule(): Promise<{ rule: UsernameRule; minLength: number }> {
    const [raw, min] = await Promise.all([
        readSetting(SETTING_KEYS.usernameRule),
        getBounded(USERNAME_MIN),
    ]);
    return { rule: isUsernameRule(raw) ? raw : DEFAULT_USERNAME_RULE, minLength: min };
}

export async function getRegistrationCaps(): Promise<RegistrationCaps> {
    const [daily, total] = await Promise.all([
        getBounded(REGISTRATION_DAILY_CAP),
        getBounded(REGISTRATION_TOTAL_CAP),
    ]);
    return { daily, total };
}
