import { z } from "zod";
import { checkPasswordPolicy, PASSWORD_POLICY } from "./password-policy";

// ==================== AUTH SCHEMAS ====================

// Login only checks presence. The strict policy runs on NEW / CHANGED
// passwords - existing accounts whose password predates the policy bump
// must still be able to sign in.
export const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required").max(PASSWORD_POLICY.MAX_LENGTH),
});

const newPasswordSchema = z.string().superRefine((val, ctx) => {
    const result = checkPasswordPolicy(val);
    if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.message ?? "Invalid password" });
    }
});

export const registerSchema = z.object({
    email: z.string().email("Invalid email address"),
    username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(20, "Username must be at most 20 characters")
        .regex(
            /^[a-zA-Z0-9_]+$/,
            "Username can only contain letters, numbers, and underscores"
        ),
    password: newPasswordSchema,
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
});

// ==================== USER SCHEMAS ====================

export const updateUserSchema = z.object({
    username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(20, "Username must be at most 20 characters")
        .regex(
            /^[a-zA-Z0-9_]+$/,
            "Username can only contain letters, numbers, and underscores"
        )
        .optional(),
    avatar: z.string().url("Invalid URL").optional().nullable(),
    /**
     * The profile route wrote both of these to the user row untyped, so a
     * signed-in account could store whatever fitted under the body cap in a
     * column meant for a locale tag and a currency code. Core owns no locale
     * list here (`i18n/config.ts` does), so this bounds the shape rather than
     * the vocabulary: a resolver that meets an unknown tag already falls back.
     */
    locale: z.string().regex(/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/, "Invalid locale").optional(),
    currency: z.string().regex(/^[A-Z]{3}$/, "Invalid currency code").optional(),
});

export const updatePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
});

// ==================== ROLE & PERMISSION SCHEMAS ====================

export const roleSchema = z.object({
    name: z.string().min(1).max(50).regex(/^[a-z_]+$/, "Name must be lowercase with underscores"),
    displayName: z.string().min(1).max(100),
    color: z.string().optional(),
    priority: z.number().int().optional(),
    /**
     * What this role says about each permission it has an opinion on.
     *
     * A name with no entry is the third state: nothing at all, which is not a
     * yes. `NEVER` is absolute - it beats a yes from any other role the member
     * holds - so a role that takes something away is a role an operator writes
     * once rather than an edit to every other role.
     */
    permissions: z
        .array(
            z.object({
                name: z.string().min(3).max(128).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
                state: z.enum(["ALLOW", "NEVER"]),
            }),
        )
        .max(500)
        .optional(),
    /**
     * Declarations an operator writes for this role's name and badge. Bounded
     * here and judged by `safeRoleCss`: which characters are dangerous is not
     * a thing a schema can say, because it depends on how a browser folds
     * escapes and comments before it reads them.
     */
    nameCss: z.string().max(2000).nullable().optional(),
    badgeCss: z.string().max(2000).nullable().optional(),
});

// ==================== SETTINGS SCHEMAS ====================

export const settingSchema = z.object({
    key: z.string().min(1),
    value: z.any(),
    module: z.string().optional(),
});

// Type exports
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type RoleInput = z.infer<typeof roleSchema>;
