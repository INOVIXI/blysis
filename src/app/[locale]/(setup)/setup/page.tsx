"use client";

import { Fragment, useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/core/components/ui/button";
import { toast } from "sonner";
import { defaultThemeId } from "@/core/generated/theme-registry";
import { resolveInstallPlan, type CatalogEntry } from "@/core/lib/install-plan";
import { checkPasswordPolicy } from "@/core/lib/password-policy";
import { Rocket, UserCog, Globe, Compass, Palette, Package, CheckCircle2, ChevronLeft, ChevronRight, Loader2, ArrowRight } from "lucide-react";
import type { ThemeOption, PresetOption, ModuleOption, SetupResult } from "./types";
import { WelcomeStep } from "./_steps/WelcomeStep";
import { AdminStep } from "./_steps/AdminStep";
import { SiteStep } from "./_steps/SiteStep";
import { SiteTypeStep } from "./_steps/SiteTypeStep";
import { ThemeStep } from "./_steps/ThemeStep";
import { ModulesStep } from "./_steps/ModulesStep";
import { DoneStep } from "./_steps/DoneStep";
import { errorMessage } from "@/core/lib/write-result";

/**
 * Known categories in display order. Anything a module declares that isn't
 * here still renders - it lands in "other" - so core never gates which
 * categories exist.
 */

const STEP_IDS = ["welcome", "admin", "site", "type", "theme", "modules", "done"] as const;
const STEP_ICONS = [Rocket, UserCog, Globe, Compass, Palette, Package, CheckCircle2];
const LAST_INPUT_STEP = STEP_IDS.length - 1; // "modules" - the step that submits
const DONE_STEP = STEP_IDS.length; // 1-based

export default function SetupWizardPage() {
    const t = useTranslations("setup");

    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [result, setResult] = useState<SetupResult | null>(null);

    // Step 2: Admin
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");

    // Step 3: Site
    // Empty, not the product's name. This is the first field of the first
    // screen an operator ever sees, and it is asking what *their* site is
    // called; offering the name of the thing they installed answers it wrong
    // and most of them press next.
    const [siteName, setSiteName] = useState("");
    const [siteDescription, setSiteDescription] = useState("");
    const [defaultLocaleCode, setDefaultLocaleCode] = useState("en");

    // Step 4: Site type - presets are marketplace data, never a list in core.
    const [presets, setPresets] = useState<PresetOption[]>([]);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

    // Step 5: Theme - the default id comes from the generated theme registry
    // so core never names a specific theme.
    const [themes, setThemes] = useState<ThemeOption[]>([]);
    const [activeTheme, setActiveTheme] = useState<string>(defaultThemeId);

    // Step 6: Modules - populated from the marketplace catalog at mount time.
    const [catalog, setCatalog] = useState<ModuleOption[]>([]);
    const [picked, setPicked] = useState<string[]>([]);

    useEffect(() => {
        fetch("/api/setup/themes")
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { themes?: ThemeOption[] } | null) => {
                if (!data?.themes?.length) return;
                setThemes(data.themes);
                if (!data.themes.some((x) => x.id === defaultThemeId)) {
                    setActiveTheme(data.themes[0].id);
                }
            })
            .catch(() => {
                /* non-fatal - the theme step explains the empty state */
            });

        fetch("/api/setup/presets")
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { presets?: PresetOption[] } | null) => {
                if (data?.presets?.length) setPresets(data.presets);
            })
            .catch(() => {
                /* non-fatal - the site-type step explains the empty state */
            });

        fetch("/api/setup/modules")
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { modules?: Array<Partial<ModuleOption> & { id: string; name: string }> } | null) => {
                if (!data?.modules) return;
                setCatalog(
                    data.modules.map((m) => ({
                        id: m.id,
                        name: m.name,
                        description: m.description ?? "",
                        category: m.category ?? "other",
                        tags: m.tags ?? [],
                        dependencies: m.dependencies ?? [],
                        conflicts: m.conflicts ?? [],
                        version: m.version ?? "0.0.0",
                        coreVersion: m.coreVersion ?? null,
                    })),
                );
            })
            .catch(() => {
                /* non-fatal - modules step shows an empty list */
            });
    }, []);

    // Everything the wizard shows about the selection - what will actually be
    // installed, what got pulled in, and why a combination is refused - comes
    // from the same planner the setup API runs server-side. Two
    // implementations would eventually disagree, and the operator would be
    // shown one thing and given another.
    const catalogEntries: CatalogEntry[] = useMemo(
        () =>
            catalog.map((m) => ({
                id: m.id,
                version: m.version,
                dependencies: m.dependencies,
                conflicts: m.conflicts,
                ...(m.coreVersion ? { coreVersion: m.coreVersion } : {}),
            })),
        [catalog],
    );

    const plan = useMemo(
        () => resolveInstallPlan(picked, catalogEntries),
        [picked, catalogEntries],
    );

    const applyPreset = (preset: PresetOption) => {
        setSelectedPreset(preset.id);
        setPicked(preset.modules);
        if (preset.theme) setActiveTheme(preset.theme);
    };

    const togglePicked = (id: string) => {
        setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
        // A hand-edited selection is no longer the preset's selection.
        setSelectedPreset(null);
    };

    const canAdvance = (): boolean => {
        switch (step) {
            case 1:
                return true;
            case 2:
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
                if (!username || username.length < 3) return false;
                // The same policy the setup API applies. Advancing on a
                // weaker rule meant walking through four more steps and
                // collecting a 400 at the end, with the wizard already past
                // the screen that could fix it.
                if (!checkPasswordPolicy(password).ok) return false;
                if (password !== passwordConfirm) return false;
                return true;
            case 3:
                return siteName.trim().length > 0;
            case 4:
                return true;
            case 5:
                return activeTheme.length > 0;
            case 6:
                // Never let a refused combination reach the API - the server
                // would reject it after the admin account is already created.
                return plan.errors.length === 0;
            default:
                return true;
        }
    };

    const goNext = () => {
        if (!canAdvance()) {
            toast.error(t("incomplete"));
            return;
        }
        if (step < DONE_STEP) setStep(step + 1);
    };

    const goBack = () => {
        if (step > 1) setStep(step - 1);
    };

    const handleSubmit = async () => {
        if (!canAdvance()) {
            toast.error(t("incomplete"));
            return;
        }
        setSubmitting(true);
        try {
            const res = await fetch("/api/setup", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    admin: { email, username, password },
                    site: { siteName, siteDescription, defaultLocale: defaultLocaleCode },
                    theme: activeTheme,
                    // Send the planned order, not the raw clicks: dependencies
                    // are included and prerequisites come first.
                    modules: plan.order,
                }),
            });

            const data = (await res.json()) as SetupResult & { error?: string };

            if (!res.ok || !data.success) {
                toast.error(errorMessage(data, t("failed"), t));
                setSubmitting(false);
                return;
            }

            setResult(data);
            setCompleted(true);
            setStep(DONE_STEP);
        } catch {
            toast.error(t("failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-2xl">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-2">
                        <Rocket className="w-6 h-6 text-primary" />
                        <span className="font-bold text-2xl text-foreground">{t("title")}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>

                {/* Progress.
                    `items-start` plus a fixed offset on the connector, rather
                    than centring the whole column: a label that wraps to two
                    lines ("Site type" in English) makes its column taller, and
                    a centred connector then sits lower than its neighbours. The
                    offset is half the 36px circle, less half the 2px line. */}
                <div className="flex items-start mb-8">
                    {STEP_IDS.map((id, idx) => {
                        const Icon = STEP_ICONS[idx];
                        const number = idx + 1;
                        const reached = step >= number;
                        const active = step === number;
                        return (
                            <Fragment key={id}>
                                <div className="flex w-20 shrink-0 flex-col items-center">
                                    <div
                                        className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${
                                            active
                                                ? "bg-primary border-primary text-primary-foreground"
                                                : reached
                                                  ? "bg-primary/10 border-primary text-primary"
                                                  : "bg-card border-border text-muted-foreground"
                                        }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <span
                                        className={`text-[11px] mt-1 text-center leading-tight ${
                                            active ? "text-foreground font-medium" : "text-muted-foreground"
                                        }`}
                                    >
                                        {t(`steps.${id}`)}
                                    </span>
                                </div>
                                {idx < STEP_IDS.length - 1 && (
                                    <div
                                        className={`h-0.5 mt-[17px] flex-1 ${
                                            step > number ? "bg-primary" : "bg-border"
                                        }`}
                                    />
                                )}
                            </Fragment>
                        );
                    })}
                </div>

                <div className="bg-card border border-border rounded-lg shadow-sm p-6">
                    {step === 1 && <WelcomeStep />}
                    {step === 2 && (
                        <AdminStep
                            email={email}
                            username={username}
                            password={password}
                            passwordConfirm={passwordConfirm}
                            setEmail={setEmail}
                            setUsername={setUsername}
                            setPassword={setPassword}
                            setPasswordConfirm={setPasswordConfirm}
                        />
                    )}
                    {step === 3 && (
                        <SiteStep
                            siteName={siteName}
                            siteDescription={siteDescription}
                            defaultLocaleCode={defaultLocaleCode}
                            setSiteName={setSiteName}
                            setSiteDescription={setSiteDescription}
                            setDefaultLocaleCode={setDefaultLocaleCode}
                        />
                    )}
                    {step === 4 && (
                        <SiteTypeStep
                            presets={presets}
                            selected={selectedPreset}
                            onSelect={applyPreset}
                        />
                    )}
                    {step === 5 && (
                        <ThemeStep themes={themes} activeTheme={activeTheme} setActiveTheme={setActiveTheme} />
                    )}
                    {step === 6 && (
                        <ModulesStep
                            catalog={catalog}
                            picked={picked}
                            plan={plan}
                            onToggle={togglePicked}
                            onClear={() => {
                                setPicked([]);
                                setSelectedPreset(null);
                            }}
                        />
                    )}
                    {step === DONE_STEP && <DoneStep completed={completed} result={result} />}
                </div>

                {step < DONE_STEP && (
                    <div className="flex items-center justify-between mt-6">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={goBack}
                            disabled={step === 1 || submitting}
                        >
                            <ChevronLeft className="w-4 h-4" /> {t("back")}
                        </Button>

                        {step < LAST_INPUT_STEP && (
                            <Button
                                type="button"
                                onClick={goNext}
                                disabled={!canAdvance()}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                {t("next")} <ChevronRight className="w-4 h-4" />
                            </Button>
                        )}

                        {step === LAST_INPUT_STEP && (
                            <Button
                                type="button"
                                onClick={handleSubmit}
                                disabled={submitting || !canAdvance()}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" /> {t("finishing")}
                                    </>
                                ) : (
                                    <>
                                        {t("finish")} <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
