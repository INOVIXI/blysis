"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PageFrame } from "@/core/sdk/layout";
import { Button, Card, CardContent, Input, Label, LoadFailed, NativeSelect, Textarea, useConfirm } from "@/core/sdk/ui";
import { errorMessage } from "@/core/sdk";
import { Coins, Loader2, Plus } from "lucide-react";
import { useSession } from "next-auth/react";

/**
 * What members are selling each other.
 *
 * The kinds in the form come from the server rather than from a list here:
 * this module has no idea what can be handed over, and a seller must not be
 * able to offer something nothing can deliver.
 */
interface Listing {
    id: string;
    title: string;
    body: string | null;
    price: number;
    kind: string;
    seller: { id: string; username: string } | null;
}

interface Kind {
    kind: string;
    labelKey?: string;
    label: string;
}

/**
 * The board, drawn from what the server already read.
 *
 * The listings used to be fetched on mount, so the HTML the server sent
 * carried no listing, no title and no price. The server reads the first page
 * now; listing something, buying something and reloading after either still
 * ask the endpoint.
 */
export function ListingBoard({ initial }: { initial: Listing[] }) {
    const { data: session } = useSession();
    const t = useTranslations("marketplace");
    const commonT = useTranslations("common");
    // No namespace: a kind names its key in full, because the
    // module that supplies it is not one this screen knows.
    const anyT = useTranslations();
    const { confirm } = useConfirm();
    const [listings, setListings] = useState<Listing[]>(initial);
    const [kinds, setKinds] = useState<Kind[] | null>(null);
    const [kindsFailed, setKindsFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);

    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [price, setPrice] = useState("");
    const [kind, setKind] = useState("");

    /*
     * The first page came with the page itself, so this only runs when
     * something on the board has changed - a listing made, a listing bought -
     * which is what bumps `reloadKey`.
     */
    const serverDrewThisPage = useRef(true);

    useEffect(() => {
        if (serverDrewThisPage.current) { serverDrewThisPage.current = false; return; }
        let cancelled = false;
        setLoading(true);
        fetch("/api/v1/marketplace/listings")
            .then((res) => { if (!res.ok) throw new Error("load"); return res.json(); })
            .then((data) => { if (!cancelled) { setListings(data.listings ?? []); setFailed(false); } })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    /*
     * Null until it is known. An empty list means "nothing here can hand
     * anything over, so nobody can sell", and a failed read must not be
     * mistaken for that: the form would vanish with no explanation.
     *
     * A reader who is not signed in is a third thing and used to be counted as
     * the second. The endpoint is `openTo: "member"`, so it answers 401 to
     * them - correctly, and every time - and the board told them we could not
     * check what was sellable, with a Retry that asked again and got the same
     * refusal for ever. They cannot sell here; that is a fact about them and
     * not a fault, so nothing is asked and nothing is said.
     */
    const signedIn = Boolean(session?.user);

    useEffect(() => {
        if (!signedIn) { setKinds(null); setKindsFailed(false); return; }
        let cancelled = false;
        fetch("/api/v1/marketplace/delivery-kinds")
            .then((res) => { if (!res.ok) throw new Error("load"); return res.json(); })
            .then((data) => {
                if (cancelled) return;
                setKinds(Array.isArray(data.kinds) ? data.kinds : []);
                setKindsFailed(false);
            })
            .catch(() => { if (!cancelled) setKindsFailed(true); });
        return () => { cancelled = true; };
    }, [reloadKey, signedIn]);

    const list = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy("new");
        try {
            const res = await fetch("/api/v1/marketplace/listings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, body: body || undefined, price: Number(price), kind }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) { toast.error(errorMessage(data, t("listFailed"), t)); return; }
            setTitle(""); setBody(""); setPrice("");
            setReloadKey((k) => k + 1);
            toast.success(t("listed"));
        } catch {
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setBusy(null);
        }
    };

    const buy = async (listing: Listing) => {
        const sure = await confirm({
            title: t("buyConfirmTitle"),
            message: t("buyConfirmMessage", { title: listing.title, price: listing.price }),
            confirmText: t("buy"),
        });
        if (!sure) return;
        setBusy(listing.id);
        try {
            const res = await fetch(`/api/v1/marketplace/listings/${listing.id}/buy`, { method: "POST" });
            const data = await res.json().catch(() => null);
            if (!res.ok) { toast.error(errorMessage(data, t("buyFailed"), t)); return; }
            // A sale that took the credits and could not hand the thing over
            // is the operator's to unpick, and the buyer should hear it now
            // rather than wonder where it went.
            toast[data?.delivered ? "success" : "warning"](
                data?.delivered ? t("bought") : t("boughtNotDelivered"),
            );
            setReloadKey((k) => k + 1);
        } catch {
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <PageFrame title={t("title")} description={t("subtitle")}>
            {kindsFailed && (
                <Card className="mb-6">
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                        <p className="text-sm text-muted-foreground">{t("sellUnavailable")}</p>
                        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                            {commonT("retry")}
                        </Button>
                    </CardContent>
                </Card>
            )}

            {kinds !== null && kinds.length > 0 && (
                <Card className="mb-6">
                    <CardContent className="p-6">
                        <form onSubmit={list} className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <Label htmlFor="marketTitle">{t("formTitle")}</Label>
                                    <Input id="marketTitle" value={title} onChange={(e) => setTitle(e.target.value)} required />
                                </div>
                                <div>
                                    <Label htmlFor="marketKind">{t("formKind")}</Label>
                                    <NativeSelect id="marketKind" value={kind} onChange={(e) => setKind(e.target.value)} required>
                                        <option value="">{t("formPickKind")}</option>
                                        {kinds.map((entry) => (
                                            <option key={entry.kind} value={entry.kind}>
                                                {/* The module's own words in
                                                    the reader's language when
                                                    it declared a key, and its
                                                    manifest label when it did
                                                    not. */}
                                                {entry.labelKey && anyT.has(entry.labelKey) ? anyT(entry.labelKey) : entry.label}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="marketBody">{t("formBody")}</Label>
                                <Textarea id="marketBody" rows={2} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
                            </div>
                            <div className="max-w-40">
                                <Label htmlFor="marketPrice">{t("formPrice")}</Label>
                                <Input id="marketPrice" type="number" min={1} step="1" value={price} onChange={(e) => setPrice(e.target.value)} required />
                            </div>
                            <Button type="submit" disabled={busy !== null}>
                                {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                                {t("list")}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : listings.length === 0 ? (
                <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">{t("empty")}</p></CardContent></Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {listings.map((listing) => (
                        <Card key={listing.id}>
                            <CardContent className="space-y-3 p-5">
                                <div>
                                    <p className="font-medium">{listing.title}</p>
                                    {listing.seller && (
                                        <p className="text-xs text-muted-foreground">{t("by", { name: listing.seller.username })}</p>
                                    )}
                                </div>
                                {listing.body && <p className="text-sm text-muted-foreground">{listing.body}</p>}
                                <p className="flex items-center gap-1 text-lg font-bold">
                                    <Coins className="h-4 w-4" aria-hidden="true" /> {listing.price}
                                </p>
                                <Button size="sm" className="w-full" disabled={busy !== null} onClick={() => buy(listing)}>
                                    {busy === listing.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {t("buy")}
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </PageFrame>
    );
}
