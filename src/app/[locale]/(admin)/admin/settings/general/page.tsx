"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { Loader2, Check } from "lucide-react";
import { NativeSelect } from "@/core/components/ui/native-select";
import { HASH_ALGORITHMS, type HashAlgorithm } from "@/core/lib/hash-algorithms";
import { USERNAME_RULES, type UsernameRule } from "@/core/lib/registration-rules";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { useSettingsLoad } from "@/core/hooks/useSettingsLoad";
import { MEMBER_AVATAR_UPLOADS_KEY } from "@/core/lib/member-uploads";
import {
    MEMBER_USERNAME_CHANGES_KEY,
    MEMBER_EMAIL_CHANGES_KEY,
    IDENTITY_REQUIRES_PASSWORD_KEY,
    EMAIL_CHANGE_VERIFICATION_KEY,
} from "@/core/lib/member-identity";

interface FieldDef {
    key: string;
    labelKey: string;
    type: "number" | "choice";
    defaultValue: string | number;
    descriptionKey?: string;
    /**
     * For a choice: the values and what each is called. Written out rather
     * than composed from the value, because a key built as
     * `` `${labelKey}_${value}` `` is a key no scan of the tree can find, and
     * the gate that catches a string nothing reads would then be catching
     * these instead of catching real ones.
     */
    choices?: readonly { value: string; labelKey: string }[];
}

/**
 * Typed as a record over the union, so adding an algorithm or a rule without
 * naming it stops the build rather than shipping an empty dropdown entry.
 */
const HASH_LABELS: Record<HashAlgorithm, string> = {
    bcrypt: "generalSettings_hashAlgorithm_bcrypt",
    scrypt: "generalSettings_hashAlgorithm_scrypt",
};

const USERNAME_RULE_LABELS: Record<UsernameRule, string> = {
    default: "generalSettings_usernameRule_default",
    letters_numbers: "generalSettings_usernameRule_letters_numbers",
    lowercase: "generalSettings_usernameRule_lowercase",
};

const HASH_CHOICES = HASH_ALGORITHMS.map((value) => ({ value, labelKey: HASH_LABELS[value] }));
const USERNAME_RULE_CHOICES = USERNAME_RULES.map((value) => ({ value, labelKey: USERNAME_RULE_LABELS[value] }));

/**
 * Written as a choice rather than a switch because that is the control this
 * screen has, and a two-value choice says the same thing. The stored value is
 * read by `memberAvatarUploads()`, which treats anything but "false" as on: a
 * site that never opens this screen gets the useful behaviour.
 */
/**
 * Open, or closed. Three sets of words rather than one, because the questions
 * are three: what a member may upload, whether a door is open at all, and what
 * the site demands before it lets somebody through it. The upload wording was
 * reused here once - "Members may upload / Link only" beside "Username
 * changes" - which is nonsense in the exact way a reader notices and a writer
 * does not.
 */
const OPEN_CHOICES = [
    { value: "true", labelKey: "generalSettings_open" },
    { value: "false", labelKey: "generalSettings_closed" },
] as const;

/** Asked for, or not. */
const REQUIRED_CHOICES = [
    { value: "true", labelKey: "generalSettings_required" },
    { value: "false", labelKey: "generalSettings_notRequired" },
] as const;

/**
 * What a member may put on their own profile. Three positions, because an
 * operator has three: send a file, point at one, or have none at all. The
 * third was missing, so a site that did not want member pictures could only
 * take the upload away and still had every pasted address to police.
 */
const AVATAR_CHOICES = [
    { value: "upload", labelKey: "generalSettings_allowed" },
    { value: "link", labelKey: "generalSettings_notAllowed" },
    { value: "off", labelKey: "generalSettings_avatarsOff" },
] as const;


interface SectionDef {
    titleKey: string;
    fields: FieldDef[];
}

const sections: SectionDef[] = [
    {
        titleKey: "generalSettings_authSecurity",
        fields: [
            { key: "password_min_length", labelKey: "generalSettings_minPasswordLength", type: "number", defaultValue: 10, descriptionKey: "generalSettings_minPasswordLengthHint" },
            { key: "email_verify_expiry_hours", labelKey: "generalSettings_emailVerifyExpiry", type: "number", defaultValue: 24 },
            { key: "password_reset_expiry_minutes", labelKey: "generalSettings_passwordResetExpiry", type: "number", defaultValue: 60 },
            { key: "password_hash_algorithm", labelKey: "generalSettings_hashAlgorithm", type: "choice", defaultValue: "bcrypt", choices: HASH_CHOICES, descriptionKey: "generalSettings_hashAlgorithmHint" },
        ],
    },
    {
        titleKey: "generalSettings_memberContent",
        fields: [
            { key: MEMBER_AVATAR_UPLOADS_KEY, labelKey: "generalSettings_memberAvatarUploads", type: "choice", defaultValue: "upload", choices: AVATAR_CHOICES, descriptionKey: "generalSettings_memberAvatarUploadsHint" },
        ],
    },
    {
        /*
         * Who a member is, and what changing it costs them.
         *
         * The two guards default to on for the same reason: the address is the
         * account. A password reset goes there, so somebody who can rewrite it
         * from an unlocked screen owns the account, and an unproved address
         * silently sends every future reset to a mailbox nobody reads.
         */
        titleKey: "generalSettings_memberIdentity",
        fields: [
            { key: MEMBER_USERNAME_CHANGES_KEY, labelKey: "generalSettings_usernameChanges", type: "choice", defaultValue: "true", choices: OPEN_CHOICES, descriptionKey: "generalSettings_usernameChangesHint" },
            { key: MEMBER_EMAIL_CHANGES_KEY, labelKey: "generalSettings_emailChanges", type: "choice", defaultValue: "false", choices: OPEN_CHOICES, descriptionKey: "generalSettings_emailChangesHint" },
            { key: IDENTITY_REQUIRES_PASSWORD_KEY, labelKey: "generalSettings_identityPassword", type: "choice", defaultValue: "true", choices: REQUIRED_CHOICES, descriptionKey: "generalSettings_identityPasswordHint" },
            { key: EMAIL_CHANGE_VERIFICATION_KEY, labelKey: "generalSettings_emailVerification", type: "choice", defaultValue: "true", choices: REQUIRED_CHOICES, descriptionKey: "generalSettings_emailVerificationHint" },
        ],
    },
    {
        titleKey: "generalSettings_registration",
        fields: [
            { key: "username_rule", labelKey: "generalSettings_usernameRule", type: "choice", defaultValue: "default", choices: USERNAME_RULE_CHOICES, descriptionKey: "generalSettings_usernameRuleHint" },
            { key: "username_min_length", labelKey: "generalSettings_usernameMinLength", type: "number", defaultValue: 3 },
            { key: "registration_daily_cap", labelKey: "generalSettings_registrationDailyCap", type: "number", defaultValue: 0, descriptionKey: "generalSettings_registrationCapHint" },
            { key: "registration_total_cap", labelKey: "generalSettings_registrationTotalCap", type: "number", defaultValue: 0 },
        ],
    },
    {
        titleKey: "generalSettings_cachePerformance",
        fields: [
            { key: "settings_cache_seconds", labelKey: "generalSettings_cacheSeconds", type: "number", defaultValue: 60 },
        ],
    },
];

const allFields = sections.flatMap((s) => s.fields);

/** The header's submit button points at the form by id; they are the same form. */
const FORM_ID = "general-settings-form";

export default function GeneralSettingsPage() {
    const t = useTranslations("admin");
    const [saving, setSaving] = useState(false);
    const [values, setValues] = useState<Record<string, string>>({});

    // Every field falls back to its default, so a failed read renders a form
    // full of defaults that saving would write over the real settings.
    const { loading, failed, retry } = useSettingsLoad((s) => {
        const v: Record<string, string> = {};
        for (const field of allFields) {
            v[field.key] = s[field.key] !== undefined && s[field.key] !== null
                ? String(s[field.key])
                : String(field.defaultValue);
        }
        setValues(v);
    });

    const setValue = (key: string, val: string) => {
        setValues((prev) => ({ ...prev, [key]: val }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);

        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
            });

            if (!res.ok) {
                toast.error(t("generalSettings_saveFailed"));
                return;
            }

            toast.success(t("generalSettings_saved"));
        } catch {
            toast.error(t("generalSettings_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("generalSettings_title")} description={t("generalSettings_subtitle")} />
                <Card><CardContent><LoadFailed onRetry={retry} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            {/* The page is one form, so its save is a page action: it sits in
                the header with everything else a screen offers, not under
                whichever card happens to be last. */}
            <AdminPageHeader
                title={t("generalSettings_title")}
                description={t("generalSettings_subtitle")}
                actions={
                    <Button type="submit" form={FORM_ID} disabled={saving}>
                        {saving ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> {t("generalSettings_saving")}</>
                        ) : (
                            <><Check className="w-4 h-4" /> {t("generalSettings_saveSettings")}</>
                        )}
                    </Button>
                }
            />

            <form id={FORM_ID} onSubmit={handleSave}>
                <div className="grid lg:grid-cols-2 gap-6">
                    {sections.map((section) => (
                        <Card key={section.titleKey}>
                            <CardHeader>
                                <CardTitle>{t(section.titleKey)}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {section.fields.map((field) => (
                                    <div key={field.key}>
                                        <Label htmlFor={field.key}>{t(field.labelKey)}</Label>
                                        {field.type === "choice" ? (
                                            <NativeSelect
                                                id={field.key}
                                                value={values[field.key] as string}
                                                onChange={(e) => setValue(field.key, e.target.value)}
                                            >
                                                {(field.choices ?? []).map((choice) => (
                                                    <option key={choice.value} value={choice.value}>
                                                        {t(choice.labelKey)}
                                                    </option>
                                                ))}
                                            </NativeSelect>
                                        ) : (
                                            <Input
                                                id={field.key}
                                                aria-label={t(field.labelKey)}
                                                type="number"
                                                value={values[field.key] as string}
                                                onChange={(e) => setValue(field.key, e.target.value)}
                                                placeholder={String(field.defaultValue)}
                                                min={0}
                                            />
                                        )}
                                        {field.descriptionKey && (
                                            <p className="text-xs text-muted-foreground mt-1">{t(field.descriptionKey)}</p>
                                        )}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    ))}
                </div>

            </form>
        </>
    );
}
