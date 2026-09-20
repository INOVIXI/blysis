"use client";


import { useTranslations } from "next-intl";
import {
    AvailabilityFields,
    EMPTY_AVAILABILITY,
    availabilityPayload,
    type AvailabilityValue,
} from "../_fields/AvailabilityFields";
import { GrantFields } from "../_fields/GrantFields";
import { EMPTY_GRANT, grantPayload, type GrantValue } from "../_fields/grant-payload";
import { RequirementFields } from "../_fields/RequirementFields";
import { EMPTY_REQUIREMENT, requirementPayload, type RequirementValue } from "../_fields/requirement-payload";
import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "@/core/sdk/navigation";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, CheckboxField, UrlOrFile, Input, Label, NativeSelect, RichTextEditor, useSiteSettings } from "@/core/sdk/ui";
import { ArrowLeft, Loader2, X } from "lucide-react";
import { writeError } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";

interface Category {
    id: string;
    name: string;
    slug: string;
}

export default function NewProductPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const router = useRouter();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [availability, setAvailability] = useState<AvailabilityValue>(EMPTY_AVAILABILITY);
    const [grant, setGrant] = useState<GrantValue>(EMPTY_GRANT);
    const [requires, setRequires] = useState<RequirementValue>(EMPTY_REQUIREMENT);
    // The zone the hours are read in, shown beside them: "18:00" with no zone
    // next to it is what makes somebody schedule a sale three hours out.
    const { settings } = useSiteSettings();
    const timeZone = (settings.site_timezone as string) || "UTC";

    const [form, setForm] = useState({
        name: "",
        description: "",
        price: "",
        comparePrice: "",
        image: "",
        images: [] as string[],
        stock: "",
        categoryId: "",
        type: "DIGITAL" as string,
        isActive: true,
        isFeatured: false,
        giftable: true,
        subscriptionInterval: "month" as string,
        subscriptionIntervalCount: "1",
    });

    useEffect(() => {
        fetch("/api/v1/store/categories")
            .then((res) => res.json())
            .then((data) => setCategories(data.categories || []))
            .catch(() => {});
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const payload = {
                name: form.name,
                description: form.description || undefined,
                price: parseFloat(form.price),
                comparePrice: form.comparePrice ? parseFloat(form.comparePrice) : null,
                image: form.image || (form.images.length > 0 ? form.images[0] : null),
                images: form.images.length > 0 ? form.images : undefined,
                stock: form.stock ? parseInt(form.stock) : null,
                categoryId: form.categoryId || null,
                type: form.type,
                isActive: form.isActive,
                isFeatured: form.isFeatured,
                giftable: form.giftable,
                subscriptionInterval: form.type === "SUBSCRIPTION" ? form.subscriptionInterval : null,
                subscriptionIntervalCount: form.type === "SUBSCRIPTION" ? parseInt(form.subscriptionIntervalCount) || 1 : null,
                ...availabilityPayload(availability),
                ...grantPayload(grant),
                ...requirementPayload(requires),
            };

            const res = await fetch("/api/v1/store/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const failed = await writeError(res, t("adm_createProductFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }

            router.push("/admin/store/products");
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("adm_newProduct")}
                description={t("adm_createNewListing")}
                backHref="/admin/store/products"
                backLabel={commonT("back")}
            />

            <form onSubmit={handleSubmit}>
                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Main Info */}
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_productDetails")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label htmlFor="name">{`${t("adm_name")} *`}</Label>
                                    <Input
                                        id="name"
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        placeholder={t("adm_productName")}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label id="description-label">{t("adm_description")}</Label>
                                    <RichTextEditor
                                        labelledBy="description-label"
                                        value={form.description}
                                        onChange={(value: string) => setForm({ ...form, description: value })}
                                        placeholder={t("adm_productDescription")}
                                    />
                                </div>
                                <div>
                                    <UrlOrFile
                                        id="image"
                                        label={t("adm_mainImageUrl")}
                                        value={form.image || ""}
                                        onChange={(v) => setForm({ ...form, image: v })}
                                        accept="image/*"
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_additionalImages")}</Label>
                                    {form.images.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2">
                                            {form.images.map((url, i) => (
                                                <div key={i} className="relative group">
                                                    <Image src={url} alt="" width={64} height={64} className="w-16 h-16 rounded-lg object-cover border border-border" />
                                                    <button
                                                        type="button"
                                                        onClick={() => setForm({ ...form, images: form.images.filter((_, idx) => idx !== i) })}
                                                        aria-label={commonT("remove")}
                                                        className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <X className="w-3 h-3" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <UrlOrFile
                                        value=""
                                        onChange={(v) => {
                                            if (v) setForm({ ...form, images: [...form.images, v] });
                                        }}
                                        accept="image/*"
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_pricing")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="price">{`${t("adm_price")} *`}</Label>
                                        <Input
                                            id="price"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={form.price}
                                            onChange={(e) => setForm({ ...form, price: e.target.value })}
                                            placeholder="0.00"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor="comparePrice">{t("adm_comparePrice")}</Label>
                                        <Input
                                            id="comparePrice"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={form.comparePrice}
                                            onChange={(e) => setForm({ ...form, comparePrice: e.target.value })}
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_organization")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label htmlFor="category">{t("adm_category")}</Label>
                                    <NativeSelect
                                        id="category"
                                        value={form.categoryId}
                                        onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="w-full"
                                    >
                                        <option value="">{t("adm_noCategory")}</option>
                                        {categories.map((cat) => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </NativeSelect>
                                </div>
                                <div>
                                    <Label htmlFor="type">{t("adm_type")}</Label>
                                    <NativeSelect
                                        id="type"
                                        value={form.type}
                                        onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full"
                                    >
                                        <option value="DIGITAL">{t("adm_digital")}</option>
                                        <option value="PHYSICAL">{t("adm_physical")}</option>
                                        <option value="GAME_ITEM">{t("adm_gameItem")}</option>
                                        <option value="SUBSCRIPTION">{t("adm_subscription")}</option>
                                    </NativeSelect>
                                </div>
                                {form.type === "SUBSCRIPTION" && (
                                    <>
                                        <div>
                                            <Label htmlFor="subscriptionInterval">{t("adm_subscriptionInterval")}</Label>
                                            <NativeSelect
                                                id="subscriptionInterval"
                                                value={form.subscriptionInterval}
                                                onChange={(e) => setForm({ ...form, subscriptionInterval: e.target.value })} className="w-full"
                                            >
                                                <option value="month">{t("adm_monthly")}</option>
                                                <option value="year">{t("adm_yearly")}</option>
                                            </NativeSelect>
                                        </div>
                                        <div>
                                            <Label htmlFor="subscriptionIntervalCount">{t("adm_intervalCount")}</Label>
                                            <Input
                                                id="subscriptionIntervalCount"
                                                type="number"
                                                min="1"
                                                max="12"
                                                value={form.subscriptionIntervalCount}
                                                onChange={(e) => setForm({ ...form, subscriptionIntervalCount: e.target.value })}
                                                placeholder="1"
                                            />
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {t("adm_intervalCountHelp")}
                                            </p>
                                        </div>
                                    </>
                                )}
                                <div>
                                    <Label htmlFor="stock">{t("adm_stock")}</Label>
                                    <Input
                                        id="stock"
                                        type="number"
                                        min="0"
                                        value={form.stock}
                                        onChange={(e) => setForm({ ...form, stock: e.target.value })}
                                        placeholder={t("adm_leaveEmptyUnlimited")}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <GrantFields value={grant} onChange={setGrant} />

                        <RequirementFields value={requires} onChange={setRequires} />

                    <AvailabilityFields value={availability} onChange={setAvailability} timeZone={timeZone} />

                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_status")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <CheckboxField
                                    checked={form.isActive}
                                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                                    label={t("adm_active")}
                                />
                                <CheckboxField
                                    checked={form.isFeatured}
                                    onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
                                    label={t("adm_featured")}
                                />
                                <CheckboxField
                                    checked={form.giftable}
                                    onChange={(e) => setForm({ ...form, giftable: e.target.checked })}
                                    label={t("adm_giftable")}
                                    description={t("adm_giftableHint")}
                                />
                            </CardContent>
                        </Card>

                        {error && (
                            <div role="alert" className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full" disabled={saving}>
                            {saving ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</>
                            ) : (
                                t("adm_createProduct")
                            )}
                        </Button>
                    </div>
                </div>
            </form>
        </>
    );
}
