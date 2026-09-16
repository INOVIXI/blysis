"use client";


import { useTranslations } from "next-intl";
import {
    AvailabilityFields,
    EMPTY_AVAILABILITY,
    availabilityPayload,
    type AvailabilityValue,
} from "../../_fields/AvailabilityFields";
import { timeFromMinutes } from "../../_fields/time-of-day";
import { GrantFields } from "../../_fields/GrantFields";
import { EMPTY_GRANT, grantPayload, type GrantValue } from "../../_fields/grant-payload";
import { RequirementFields } from "../../_fields/RequirementFields";
import { EMPTY_REQUIREMENT, requirementPayload, type RequirementValue } from "../../_fields/requirement-payload";
import { instantToWallClock } from "@/core/sdk";
import { useState, useEffect, use } from "react";
import Image from "next/image";
import { useRouter } from "@/core/sdk/navigation";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, CheckboxField, UrlOrFile, Input, Label, LoadFailed, NativeSelect, RichTextEditor, useConfirm, useSiteSettings } from "@/core/sdk/ui";
import { ArrowLeft, Loader2, Trash2, X, Plus } from "lucide-react";
import { writeError } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";

interface Category {
    id: string;
    name: string;
    slug: string;
}

interface PageProps {
    params: Promise<{ id: string; locale: string }>;
}

export default function EditProductPage(props: PageProps) {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const params = use(props.params);
    const router = useRouter();
    const productId = params.id;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [availability, setAvailability] = useState<AvailabilityValue>(EMPTY_AVAILABILITY);
    const [grant, setGrant] = useState<GrantValue>(EMPTY_GRANT);
    const [requires, setRequires] = useState<RequirementValue>(EMPTY_REQUIREMENT);
    // The zone the hours are read in, shown beside them: "18:00" with no zone
    // next to it is what makes somebody schedule a sale three hours out.
    const { settings } = useSiteSettings();
    const timeZone = (settings.site_timezone as string) || "UTC";
    const { confirm } = useConfirm();

    const [form, setForm] = useState({
        name: "",
        description: "",
        price: "",
        comparePrice: "",
        image: "",
        images: [] as string[],
        stock: "",
        categoryId: "",
        type: "DIGITAL",
        isActive: true,
        isFeatured: false,
        subscriptionInterval: "month" as string,
        subscriptionIntervalCount: "1",
    });
    // Without this the form rendered with every field blank after a failed
    // load, and saving it would have written those blanks over the product.
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            // The operator's endpoint, not the public one: this form has a
            // field for every column, and the product worth opening is often
            // the one that was just switched off, which the public read hides.
            fetch(`/api/v1/store/admin/products/${productId}`).then((r) => {
                if (!r.ok) throw new Error("load failed");
                return r.json();
            }),
            fetch("/api/v1/store/categories").then((r) => r.json()),
        ]).then(([productData, catData]) => {
            if (cancelled) return;
            const p = productData.product;
            if (p) {
                setForm({
                    name: p.name || "",
                    description: p.description || "",
                    price: String(p.price || ""),
                    comparePrice: p.comparePrice ? String(p.comparePrice) : "",
                    image: p.image || "",
                    images: p.images || [],
                    stock: p.stock !== null ? String(p.stock) : "",
                    categoryId: p.categoryId || "",
                    type: p.type || "DIGITAL",
                    isActive: p.isActive ?? true,
                    isFeatured: p.isFeatured ?? false,
                    subscriptionInterval: p.subscriptionInterval || "month",
                    subscriptionIntervalCount: p.subscriptionIntervalCount ? String(p.subscriptionIntervalCount) : "1",
                });
            }
            setCategories(catData.categories || []);
            const where = timeZone;
            if (p) {
                // The columns hold instants; the form shows the wall clock the
                // operator typed, in the site's zone.
                setAvailability({
                    roleId: p.roleIds?.[0] ?? "",
                    availableFrom: p.availableFrom ? instantToWallClock(new Date(p.availableFrom), where) : "",
                    availableUntil: p.availableUntil ? instantToWallClock(new Date(p.availableUntil), where) : "",
                    availableDays: p.availableDays ?? [],
                    availableFrom24: timeFromMinutes(p.availableFromMinute),
                    availableUntil24: timeFromMinutes(p.availableUntilMinute),
                    outsideWindow: p.outsideWindow || "countdown",
                    perPersonLimit: p.perPersonLimit ? String(p.perPersonLimit) : "",
                    perPersonPeriod: p.perPersonPeriod || "ever",
                    periodStock: p.periodStock ? String(p.periodStock) : "",
                    periodStockWindow: p.periodStockWindow || "day",
                    salePrice: p.salePrice ? String(p.salePrice) : "",
                    saleFrom: p.saleFrom ? instantToWallClock(new Date(p.saleFrom), where) : "",
                    saleUntil: p.saleUntil ? instantToWallClock(new Date(p.saleUntil), where) : "",
                });
                setGrant({
                    durationDays: p.durationDays ? String(p.durationDays) : "",
                    grantsRoleId: p.grantsRoleId ?? "",
                });
                setRequires({
                    requiresProductIds: p.requiresProductIds ?? [],
                    requiresAny: p.requiresAny ?? false,
                });
            }
            setFailed(false);
            setLoading(false);
        }).catch(() => {
            if (cancelled) return;
            setFailed(true);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [productId, reloadKey]);

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
                subscriptionInterval: form.type === "SUBSCRIPTION" ? form.subscriptionInterval : null,
                subscriptionIntervalCount: form.type === "SUBSCRIPTION" ? parseInt(form.subscriptionIntervalCount) || 1 : null,
                ...availabilityPayload(availability),
                ...grantPayload(grant),
                ...requirementPayload(requires),
            };

            const res = await fetch(`/api/v1/store/products/${productId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const failed = await writeError(res, t("adm_updateProductFailed"), t);
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

    const handleDelete = async () => {
        const ok = await confirm({ title: t("adm_deleteProduct"), message: t("adm_deleteProductConfirm"), variant: "danger", confirmText: t("adm_delete") });
        if (!ok) return;

        setDeleting(true);
        try {
            const res = await fetch(`/api/v1/store/products/${productId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                router.push("/admin/store/products");
            }
        } catch {
            setError(t("adm_deleteProductFailed"));
        } finally {
            setDeleting(false);
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
        return <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />;
    }

    return (
        <>
            <div className="flex items-center justify-between mb-8">
                {/* The save sits beside the delete in the header, where every
                    other admin screen keeps its primary action. It used to be
                    a full-width button at the bottom of a three-column form,
                    so on a long product the only way to save was to scroll
                    past every card first. `form="product-form"` is what lets
                    it submit from outside the form it saves. */}
                <AdminPageHeader
                    title={t("adm_editProduct")}
                    description={form.name}
                    backHref="/admin/store/products"
                    backLabel={commonT("back")}
                    actions={
                        <>
                            <Button
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={handleDelete}
                                disabled={deleting}
                            >
                                <Trash2 className="w-4 h-4" />
                                {deleting ? t("adm_deleting") : t("adm_delete")}
                            </Button>
                            <Button type="submit" form="product-form" disabled={saving}>
                                {saving ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_saving")}</>
                                ) : (
                                    t("adm_saveChanges")
                                )}
                            </Button>
                        </>
                    }
                />
            </div>

            <form id="product-form" onSubmit={handleSubmit}>
                <div className="grid lg:grid-cols-3 gap-8">
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
                                        required
                                    />
                                </div>
                                <div>
                                    <Label id="description-label">{t("adm_description")}</Label>
                                    <RichTextEditor
                                        labelledBy="description-label"
                                        value={form.description}
                                        onChange={(value: string) => setForm({ ...form, description: value })}
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
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

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

                        <RequirementFields value={requires} onChange={setRequires} selfId={productId} />

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
                            </CardContent>
                        </Card>

                        {/* RCON Commands */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm">{t("adm_deliveryCommands")}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-muted-foreground mb-2">{t("adm_deliveryCommandsHelp")}</p>
                                <ProductCommandsEditor productId={productId} />
                            </CardContent>
                        </Card>

                        {/* Custom Variables */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm">{t("adm_customVariables")}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-muted-foreground mb-2">{t("adm_customVariablesHelp")}</p>
                                <ProductVariablesEditor productId={productId} />
                            </CardContent>
                        </Card>

                        {error && (
                            <div role="alert" className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                                {error}
                            </div>
                        )}


                    </div>
                </div>
            </form>
        </>
    );
}

// Sub-component: RCON commands editor with per-server targeting
function ProductCommandsEditor({ productId }: { productId: string }) {
    const t = useTranslations("store");
    const [commands, setCommands] = useState<{ id: string; command: string; serverId?: string | null }[]>([]);
    const [servers, setServers] = useState<{ id: string; name: string }[]>([]);
    const [newCmd, setNewCmd] = useState("");
    const [newServerId, setNewServerId] = useState("");

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/product-commands?productId=${productId}`)
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                setCommands(d.commands || []);
            })
            .catch(() => {});
        // Fetch available game servers
        fetch("/api/v1/servers")
            .then((r) => r.ok ? r.json() : { servers: [] })
            .then((d) => {
                if (cancelled) return;
                setServers(d.servers || []);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [productId]);

    const addCmd = async () => {
        if (!newCmd.trim()) return;
        const res = await fetch("/api/v1/product-commands", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, command: newCmd, serverId: newServerId || null }),
        });
        if (res.ok) {
            const data = await res.json();
            setCommands([...commands, data.command]);
            setNewCmd("");
            setNewServerId("");
        }
    };

    const getServerName = (serverId?: string | null) => {
        if (!serverId) return "Default";
        return servers.find((s) => s.id === serverId)?.name || "Unknown";
    };

    return (
        <div className="space-y-2">
            {commands.map((cmd) => (
                <div key={cmd.id} className="flex items-center gap-2">
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                        {getServerName(cmd.serverId)}
                    </span>
                    <code className="flex-1 text-xs bg-muted px-2 py-1 rounded font-mono truncate">{cmd.command}</code>
                </div>
            ))}
            <div className="flex gap-2">
                {servers.length > 0 && (
                    <NativeSelect
                        value={newServerId}
                        onChange={(e) => setNewServerId(e.target.value)}
                        aria-label={t("adm_defaultServer")} className="w-32" inputSize="sm"
                    >
                        <option value="">{t("adm_defaultServer")}</option>
                        {servers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </NativeSelect>
                )}
                <Input value={newCmd} onChange={(e) => setNewCmd(e.target.value)} placeholder='give {player} diamond 64' aria-label={t("adm_deliveryCommands")} className="font-mono text-xs flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addCmd}><Plus className="w-3.5 h-3.5" /> {t("adm_add")}</Button>
            </div>
        </div>
    );
}

// Sub-component: Custom variables editor
function ProductVariablesEditor({ productId }: { productId: string }) {
    const t = useTranslations("store");
    const [vars, setVars] = useState<{ id: string; name: string; label: string; type: string }[]>([]);
    const [newLabel, setNewLabel] = useState("");

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/product-variables?productId=${productId}`)
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                setVars(d.variables || []);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [productId]);

    const addVar = async () => {
        if (!newLabel.trim()) return;
        const name = newLabel.toLowerCase().replace(/\s+/g, "_");
        const res = await fetch("/api/v1/product-variables", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, name, label: newLabel, type: "text", required: true }),
        });
        if (res.ok) {
            const data = await res.json();
            setVars([...vars, data.variable]);
            setNewLabel("");
        }
    };

    return (
        <div className="space-y-2">
            {vars.map((v) => (
                <div key={v.id} className="flex items-center gap-2 text-xs">
                    <span className="bg-muted px-2 py-1 rounded">{v.label}</span>
                    <span className="text-muted-foreground">({v.type})</span>
                </div>
            ))}
            <div className="flex gap-2">
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t("adm_variableLabelPlaceholder")} aria-label={t("adm_variableLabelPlaceholder")} className="text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={addVar}><Plus className="w-3.5 h-3.5" /> {t("adm_add")}</Button>
            </div>
        </div>
    );
}
