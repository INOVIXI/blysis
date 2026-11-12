"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, Challenge, Input, Label, Textarea, NativeSelect, CheckboxField, buttonClassName, useChallenge } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { Link, usePathname } from "@/core/sdk/navigation";
import { Loader2, CheckCircle, LogIn } from "lucide-react";
import { MySubmissions, type MySubmission } from "../../../components/MySubmissions";
import { toast } from "sonner";

interface FormField {
    name: string;
    type: string;
    label: string;
    required?: boolean;
    /** A line under the question saying how to answer it. */
    help?: string;
    placeholder?: string;
    options?: string[];
    min?: number;
    max?: number;
    maxLength?: number;
}

interface CustomForm {
    id: string;
    title: string;
    description: string | null;
    fields: FormField[];
    requireSignIn?: boolean;
}

/**
 * Who is reading, as the endpoint sees it: a visitor, or a member with what
 * they already sent to this form and how much of the allowance it used.
 */
interface Viewer {
    signedIn: boolean;
    used?: number;
    limit?: number | null;
    submissions?: MySubmission[];
}

interface PageProps {
    params: Promise<{ slug: string }>;
}

export default function FormPage({ params }: PageProps) {
    const { slug } = use(params);
    const t = useTranslations("customForms");
    const commonT = useTranslations("common");
    const pathname = usePathname();
    const [form, setForm] = useState<CustomForm | null>(null);
    const [viewer, setViewer] = useState<Viewer>({ signedIn: false });
    // Bumped after a submission, so the status beside the form is read again.
    const [reload, setReload] = useState(0);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [values, setValues] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/forms/${slug}`)
            .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                setForm(d.form);
                setViewer(d.viewer ?? { signedIn: false });
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [slug, reload]);

    /*
     * Whatever check the operator put in front of this form.
     *
     * This is the one form on the site a stranger can write through without
     * an account, and until it could ask, five submissions a minute per
     * address was the whole of what stood between it and a script. With no
     * challenge module installed this renders nothing and sends nothing.
     */
    const challenge = useChallenge();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form) return;
        setSubmitting(true);

        try {
            const res = await fetch(`/api/v1/forms/${slug}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: values, challenge: challenge.read() }),
            });

            if (res.ok) {
                setSubmitted(true);
                setReload((n) => n + 1);
                toast.success(t("submitSuccess"));
            } else {
                /*
                 * The endpoint checks the answers against the questions and
                 * says which one it refused and why. "Something went wrong"
                 * over a form somebody has just spent five minutes filling in
                 * leaves them to guess which box it was.
                 */
                const said = await res.json().catch(() => null) as
                    { reason?: string; code?: string; label?: string; limit?: number } | null;
                // A refusal about the answers names a `reason`; one about who
                // is sending, sign-in or the allowance, a `code`.
                const why = said?.reason ?? said?.code;
                const key = why
                    ? `err_${why.replace(/_(.)/g, (_, c: string) => c.toUpperCase())}`
                    : null;
                if (said?.code) setReload((n) => n + 1);
                toast.error(
                    key && t.has(key)
                        ? t(key, { label: said?.label ?? "", limit: said?.limit ?? 0 })
                        : t("submitError"),
                );
            }
        } catch {
            toast.error(t("submitError"));
        } finally {
            setSubmitting(false);
        }
    };

    const renderField = (field: FormField) => {
        const val = values[field.name] || "";
        const onChange = (v: string) => setValues({ ...values, [field.name]: v });

        switch (field.type) {
            case "textarea":
                return <Textarea value={val} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} aria-label={field.label} required={field.required} maxLength={field.maxLength} rows={4} />;
            case "select":
                return (
                    <NativeSelect value={val} onChange={(e) => onChange(e.target.value)} required={field.required} aria-label={field.label} className="w-full">
                        <option value="">{t("selectOption")}</option>
                        {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </NativeSelect>
                );
            case "radio":
                /*
                 * A real radio group, not a select drawn differently: with a
                 * handful of choices the answers are worth showing at once,
                 * and one `name` across the set is what makes a keyboard move
                 * between them with the arrows rather than the tab key.
                 */
                return (
                    <div role="radiogroup" aria-label={field.label} className="space-y-1.5">
                        {(field.options ?? []).map((opt) => (
                            <label key={opt} className="flex items-center gap-2 text-sm">
                                <input
                                    type="radio"
                                    name={field.name}
                                    value={opt}
                                    checked={val === opt}
                                    onChange={() => onChange(opt)}
                                    required={field.required}
                                    className="h-4 w-4 accent-primary"
                                />
                                <span>{opt}</span>
                            </label>
                        ))}
                    </div>
                );
            case "checkbox":
                return (
                    <CheckboxField
                        checked={val === "true"}
                        onChange={(e) => onChange(String(e.target.checked))}
                        label={field.placeholder || field.label}
                        required={field.required}
                    />
                );
            default:
                // text, email, url, tel, number and date are all one box; the
                // limits a question was given are what make it a different
                // one. `min`/`max` mean a value for a number and a day for a
                // date, which is why they are passed through as they stand.
                return (
                    <Input
                        type={field.type || "text"}
                        value={val}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={field.placeholder}
                        aria-label={field.label}
                        required={field.required}
                        min={field.min}
                        max={field.max}
                        maxLength={field.maxLength}
                    />
                );
        }
    };

    const mine = viewer.submissions ?? [];
    const mustSignIn = form?.requireSignIn === true && !viewer.signedIn;
    const allowanceSpent = typeof viewer.limit === "number" && (viewer.used ?? 0) >= viewer.limit;
    const remaining = typeof viewer.limit === "number" ? Math.max(0, viewer.limit - (viewer.used ?? 0)) : null;

    return (
        <ArrangedClientPage
            page="custom-forms.form"
            frame={{ title: form?.title ?? commonT("loading"), description: form?.description || undefined }}
            blocks={{
                form: () => (
                    loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
                    ) : !form ? (
                        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("formNotFound")}</CardContent></Card>
                    ) : mustSignIn ? (
                        <Card>
                            <CardContent className="py-12 text-center">
                                <LogIn className="w-10 h-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                                <p className="text-muted-foreground mb-4">{t("signInRequired")}</p>
                                <Link
                                    href={`/auth/login?callbackUrl=${encodeURIComponent(pathname || "/")}`}
                                    className={buttonClassName("default", "default")}
                                >
                                    {t("signIn")}
                                </Link>
                            </CardContent>
                        </Card>
                    ) : allowanceSpent ? (
                        // An answered application is a status, not a blank
                        // form inviting the member to send it again.
                        <div className="space-y-4">
                            <Card>
                                <CardContent className="py-8 text-center">
                                    <CheckCircle className="w-10 h-10 text-success mx-auto mb-3" aria-hidden="true" />
                                    <p className="font-medium text-foreground">{t("alreadyApplied")}</p>
                                </CardContent>
                            </Card>
                            <MySubmissions submissions={mine} />
                        </div>
                    ) : submitted ? (
                        <Card>
                            <CardContent className="py-12 text-center">
                                <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                                <h2 className="text-xl font-bold text-foreground mb-1">{t("thankYou")}</h2>
                                <p className="text-muted-foreground">{t("thankYouBody")}</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                        {mine.length > 0 && <MySubmissions submissions={mine} />}
                        <Card>
                            <CardContent className="pt-6">
                                {remaining !== null && (
                                    <p className="mb-4 text-sm text-muted-foreground">{t("remaining", { count: remaining })}</p>
                                )}
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    {form.fields.map((field) => (
                                        <div key={field.name}>
                                            <Label>{field.label} {field.required && <span className="text-destructive">*</span>}</Label>
                                            {/* Above the control, not below it: it is
                                                how to answer, and it is no use after
                                                somebody has answered. */}
                                            {field.help && (
                                                <p className="mb-1.5 text-xs text-muted-foreground">{field.help}</p>
                                            )}
                                            {renderField(field)}
                                        </div>
                                    ))}
                                    {/* Above the button, which is where a person
                                        looks for the last thing to do before
                                        pressing it. */}
                                    <Challenge action="forms.submit" onField={challenge.onField} />
                                    <Button type="submit" disabled={submitting}>
                                        {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("submitting")}</> : t("submit")}
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>
                        </div>
                    )
                ),
            }}
        />
    );
}
