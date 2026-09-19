"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { Button, Card, CardContent, Input, Label, Textarea, useConfirm, useFormRoute, NativeSelect, CheckboxField, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ChevronDown, ChevronUp, Copy, Loader2, Plus, X, Trash2, FileText, Link as LinkIcon, Pencil } from "lucide-react";
import { toast } from "sonner";
import { writeError } from "@/core/sdk";
import { AdminPageHeader, RowActions } from "@/core/sdk/admin";
import { FIELD_TYPES, fieldNeeds, uniqueName } from "../../lib/validations";

/**
 * The builder.
 *
 * It offered six types in a dropdown and no way to configure any of them.
 * Picking "Dropdown" changed a string in the saved JSON and nothing else:
 * there was nowhere to type the choices, so the public form drew a `<select>`
 * holding one empty entry, which a visitor cannot answer and - if the field
 * was required - cannot get past either. From the operator's seat the type
 * had not changed, because the row looked identical afterwards and so did the
 * form. The same went for a tick box, whose caption the public form reads out
 * of `placeholder`: a box that was never shown, so both forms this module
 * seeds have a required tick with nothing written beside it.
 *
 * A question is a card now, and the card asks for what the type it holds
 * needs - `fieldNeeds` in the module's own lib, so the builder, the schema
 * and the public form agree about it rather than each deciding separately.
 */

interface FormField {
    name: string;
    type: string;
    label: string;
    required: boolean;
    help?: string;
    placeholder?: string;
    options?: string[];
    min?: number;
    max?: number;
    maxLength?: number;
}

interface Form {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    fields?: FormField[];
}

export default function FormsPage() {
    const t = useTranslations("customForms");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [forms, setForms] = useState<Form[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // The builder is a screen at `?form=new` or `?form=<slug>`, not a card
    // above the list of forms.
    const { showForm: showCreate, editingId: editingSlug, formHref, openForm, closeForm } = useFormRoute();

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [fields, setFields] = useState<FormField[]>([
        { name: "name", type: "text", label: "Name", required: true },
    ]);

    const fetchForms = useCallback(async () => {
        const res = await fetch("/api/v1/forms");
        if (res.ok) { const data = await res.json(); setForms(data.forms || []); }
        setLoading(false);
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchForms(); }, [fetchForms]);

    // The builder loads the form the URL names, so `?form=<slug>` can be
    // reloaded, linked or reopened and still land on the same fields. The
    // field list is not in the index response, hence the second request.
    useEffect(() => {
        if (!editingSlug) {
            setTitle("");
            setDescription("");
            setFields([{ name: "name", type: "text", label: "Name", required: true }]);
            return;
        }
        let cancelled = false;
        fetch(`/api/v1/forms/${editingSlug}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load"))))
            .then((data) => {
                if (cancelled) return;
                const f = data.form;
                setTitle(f.title || "");
                setDescription(f.description || "");
                setFields(Array.isArray(f.fields) && f.fields.length > 0 ? f.fields : [{ name: "name", type: "text", label: "Name", required: true }]);
            })
            .catch(() => { if (!cancelled) toast.error(t("adm_loadFormFailed")); });
        return () => { cancelled = true; };
    }, [editingSlug, t]);

    const addField = () => {
        setFields([...fields, {
            name: uniqueName("field", fields.map((f) => f.name)),
            type: "text", label: "", required: false,
        }]);
    };

    const updateField = (i: number, updates: Partial<FormField>) => {
        setFields(fields.map((f, idx) => idx === i ? { ...f, ...updates } : f));
    };

    /*
     * A question's label decides the key its answers are stored under, and
     * `data` is keyed by that name - so two questions worded the same way
     * used to collide and one person's answer overwrote the other's, with
     * nothing said. The name is still readable, because somebody reads the
     * stored answers; it is the collision that is new.
     */
    const renameFromLabel = (i: number, label: string) => {
        const taken = fields.filter((_, idx) => idx !== i).map((f) => f.name);
        updateField(i, { label, name: uniqueName(label, taken) });
    };

    const removeField = (i: number) => {
        setFields(fields.filter((_, idx) => idx !== i));
    };

    const moveField = (i: number, by: -1 | 1) => {
        const to = i + by;
        if (to < 0 || to >= fields.length) return;
        const next = [...fields];
        [next[i], next[to]] = [next[to], next[i]];
        setFields(next);
    };

    const duplicateField = (i: number) => {
        const source = fields[i];
        const copy: FormField = {
            ...source,
            options: source.options ? [...source.options] : undefined,
            name: uniqueName(source.label || "field", fields.map((f) => f.name)),
        };
        setFields([...fields.slice(0, i + 1), copy, ...fields.slice(i + 1)]);
    };

    const setOption = (i: number, optionIndex: number, value: string) => {
        const options = [...(fields[i].options ?? [])];
        options[optionIndex] = value;
        updateField(i, { options });
    };

    const addOption = (i: number) => {
        updateField(i, { options: [...(fields[i].options ?? []), ""] });
    };

    const removeOption = (i: number, optionIndex: number) => {
        updateField(i, { options: (fields[i].options ?? []).filter((_, idx) => idx !== optionIndex) });
    };

    /** A number box's value, kept undefined rather than stored as NaN. */
    const numberOr = (value: string): number | undefined =>
        value.trim() === "" ? undefined : Number(value);

    const submitForm = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        const url = editingSlug ? `/api/v1/forms/${editingSlug}` : "/api/v1/forms";
        const method = editingSlug ? "PATCH" : "POST";
        try {
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, description, fields }),
            });
            if (res.ok) {
                toast.success(editingSlug ? t("adm_formSaved") : t("adm_formCreated"));
                await fetchForms();
                closeForm();
            } else {
                toast.error(t("adm_writeFailed"));
            }
        } catch {
            toast.error(t("adm_writeFailed"));
        } finally {
            setSaving(false);
        }
    };

    const deleteForm = async (slug: string) => {
        const ok = await confirm({
            title: t("adm_deleteForm"),
            message: t("adm_deleteFormConfirm"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/forms/${slug}`, { method: "DELETE" });
        const failed = await writeError(res, t("adm_writeFailed"), t);
        if (failed) { toast.error(failed); return; }
        fetchForms();
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

    if (showCreate) {
        return (
            <>
                <AdminPageHeader
                    title={editingSlug ? t("adm_editForm") : t("adm_createForm")}
                    description={t("adm_customFormsSubtitle")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={submitForm} className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{`${t("adm_formTitle")} *`}</Label>
                                    <Input aria-label={t("adm_formTitle")} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={t("adm_titlePlaceholder")} />
                                </div>
                                <div>
                                    <Label>{t("adm_description")}</Label>
                                    <Input aria-label={t("adm_description")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("adm_descriptionPlaceholder")} />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <Label>{t("adm_fields")}</Label>
                                    <Button type="button" variant="outline" size="sm" onClick={addField}>
                                        <Plus className="w-3 h-3" /> {t("adm_addField")}
                                    </Button>
                                </div>
                                <div className="space-y-3">
                                    {fields.map((field, i) => {
                                        const needs = fieldNeeds(field.type);
                                        return (
                                        // Keyed by the field's own name, not
                                        // by its index: moving a question up
                                        // with an index key hands its boxes
                                        // to whatever took its place.
                                        <Card key={field.name}>
                                            <CardContent className="p-4 space-y-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-medium text-muted-foreground">
                                                        {t("adm_question", { number: i + 1 })}
                                                    </span>
                                                    <RowActions
                                                        actions={[
                                                            { icon: ChevronUp, label: t("adm_moveUp"), onClick: () => moveField(i, -1), disabled: i === 0 },
                                                            { icon: ChevronDown, label: t("adm_moveDown"), onClick: () => moveField(i, 1), disabled: i === fields.length - 1 },
                                                            { icon: Copy, label: t("adm_duplicateField"), onClick: () => duplicateField(i) },
                                                            { icon: Trash2, label: t("adm_removeField"), onClick: () => removeField(i), destructive: true, disabled: fields.length === 1 },
                                                        ]}
                                                    />
                                                </div>

                                                <div className="grid md:grid-cols-2 gap-3">
                                                    <div>
                                                        <Label>{t("adm_fieldLabel")}</Label>
                                                        <Input
                                                            value={field.label}
                                                            onChange={(e) => renameFromLabel(i, e.target.value)}
                                                            placeholder={t("adm_fieldLabel")}
                                                            aria-label={t("adm_fieldLabel")}
                                                        />
                                                        {/* The key the answers are filed under. An
                                                            operator reading the stored answers meets
                                                            it, so it is not a secret. */}
                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            {t("adm_storedAs", { name: field.name })}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <Label>{t("fieldType")}</Label>
                                                        <NativeSelect
                                                            value={field.type}
                                                            onChange={(e) => {
                                                                // Settings the new type has no use
                                                                // for go with the old one, rather
                                                                // than riding along invisibly and
                                                                // coming back if the type is
                                                                // switched a third time.
                                                                const next = fieldNeeds(e.target.value);
                                                                updateField(i, {
                                                                    type: e.target.value,
                                                                    options: next.options ? (field.options ?? [""]) : undefined,
                                                                    placeholder: next.placeholder ? field.placeholder : undefined,
                                                                    min: next.range ? field.min : undefined,
                                                                    max: next.range ? field.max : undefined,
                                                                    maxLength: next.length ? field.maxLength : undefined,
                                                                });
                                                            }}
                                                            aria-label={t("fieldType")}
                                                        >
                                                            {FIELD_TYPES.map((type) => (
                                                                <option key={type} value={type}>
                                                                    {t(`type${type[0].toUpperCase()}${type.slice(1)}`)}
                                                                </option>
                                                            ))}
                                                        </NativeSelect>
                                                    </div>
                                                </div>

                                                <div>
                                                    <Label>{t("adm_fieldHelp")}</Label>
                                                    <Input
                                                        value={field.help ?? ""}
                                                        onChange={(e) => updateField(i, { help: e.target.value || undefined })}
                                                        placeholder={t("adm_fieldHelpPlaceholder")}
                                                        aria-label={t("adm_fieldHelp")}
                                                    />
                                                </div>

                                                {needs.options && (
                                                    <div>
                                                        <Label>{t("adm_options")}</Label>
                                                        <div className="space-y-2">
                                                            {(field.options ?? []).map((option, optionIndex) => (
                                                                <div key={optionIndex} className="flex items-center gap-2">
                                                                    <Input
                                                                        value={option}
                                                                        onChange={(e) => setOption(i, optionIndex, e.target.value)}
                                                                        placeholder={t("adm_optionPlaceholder")}
                                                                        aria-label={t("adm_optionPlaceholder")}
                                                                    />
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        aria-label={t("adm_removeOption")}
                                                                        onClick={() => removeOption(i, optionIndex)}
                                                                    >
                                                                        <X className="w-4 h-4" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => addOption(i)}>
                                                            <Plus className="w-3 h-3" /> {t("adm_addOption")}
                                                        </Button>
                                                        {(field.options ?? []).length === 0 && (
                                                            // Said here as well as refused by the
                                                            // schema: a form saved with an empty
                                                            // dropdown is one a visitor cannot get
                                                            // past, and the operator should hear
                                                            // that before they press save.
                                                            <p className="mt-2 text-xs text-destructive">{t("adm_needsOptions")}</p>
                                                        )}
                                                    </div>
                                                )}

                                                {needs.placeholder && (
                                                    <div>
                                                        <Label>{field.type === "checkbox" ? t("adm_checkboxCaption") : t("adm_fieldPlaceholder")}</Label>
                                                        <Input
                                                            value={field.placeholder ?? ""}
                                                            onChange={(e) => updateField(i, { placeholder: e.target.value || undefined })}
                                                            aria-label={field.type === "checkbox" ? t("adm_checkboxCaption") : t("adm_fieldPlaceholder")}
                                                        />
                                                    </div>
                                                )}

                                                {(needs.range || needs.length) && (
                                                    // Two columns only when
                                                    // there are two boxes: a
                                                    // lone limit takes the
                                                    // width rather than
                                                    // leaving half the row
                                                    // empty beside it.
                                                    <div className={`grid gap-3 ${needs.range ? "md:grid-cols-2" : ""}`}>
                                                        {needs.range && (
                                                            <>
                                                                <div>
                                                                    <Label>{t("adm_min")}</Label>
                                                                    <Input
                                                                        type="number"
                                                                        value={field.min ?? ""}
                                                                        onChange={(e) => updateField(i, { min: numberOr(e.target.value) })}
                                                                        aria-label={t("adm_min")}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <Label>{t("adm_max")}</Label>
                                                                    <Input
                                                                        type="number"
                                                                        value={field.max ?? ""}
                                                                        onChange={(e) => updateField(i, { max: numberOr(e.target.value) })}
                                                                        aria-label={t("adm_max")}
                                                                    />
                                                                </div>
                                                            </>
                                                        )}
                                                        {needs.length && (
                                                            <div>
                                                                <Label>{t("adm_maxLength")}</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    value={field.maxLength ?? ""}
                                                                    onChange={(e) => updateField(i, { maxLength: numberOr(e.target.value) })}
                                                                    aria-label={t("adm_maxLength")}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <CheckboxField
                                                    checked={field.required}
                                                    onChange={(e) => updateField(i, { required: e.target.checked })}
                                                    label={t("adm_required")}
                                                />
                                            </CardContent>
                                        </Card>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    {editingSlug ? t("adm_saveChanges") : t("adm_createFormButton")}
                                </Button>
                                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                                    {t("adm_cancel")}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_customForms")}
                description={t("adm_customFormsSubtitle")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_newForm")}</Link>
                </>}
            />

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {forms.length === 0 ? (
                    <Card className="col-span-full"><CardContent className="py-8 text-center text-muted-foreground">{t("adm_noFormsYet")}</CardContent></Card>
                ) : forms.map((form) => (
                    <Card key={form.id}>
                        <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex-1 min-w-0">
                                    <FileText className="w-5 h-5 text-muted-foreground mb-1" />
                                    <h2 className="font-medium">{form.title}</h2>
                                    {form.description && <p className="text-xs text-muted-foreground">{form.description}</p>}
                                </div>
                                <div className="flex gap-1">
                                    <Button aria-label={commonT("edit")} variant="ghost" size="sm" onClick={() => openForm(form.slug)}><Pencil className="w-3 h-3" /></Button>
                                    <Button aria-label={commonT("delete")} variant="ghost" size="sm" className="text-destructive" onClick={() => deleteForm(form.slug)}><Trash2 className="w-3 h-3" /></Button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <LinkIcon className="w-3 h-3" /> /form/{form.slug}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </>
    );
}
