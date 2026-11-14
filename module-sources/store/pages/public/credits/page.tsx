"use client";

/**
 * Loading credits: type an amount in the site currency, or pick a preset or a
 * package, and pay through a gateway.
 *
 * Until this page the only way to buy credits on screen was a package card in
 * the profile, and a shop with no packages offered nothing at all, although
 * the buy route took a typed amount. The preview here is `quoteTopUp` run in
 * the browser with the same settings and campaigns the route will read, so
 * "you pay X, you get N and B bonus" is what the payment starts with.
 *
 * A signed-out visitor is sent to sign in and brought back: a top-up belongs
 * to an account, and the form is no use before there is one.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { useRouter } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, LoadFailed, RadioField, useSiteCurrency } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { dateLocaleTag, errorMessage } from "@/core/sdk";
import type { BonusCampaign } from "../../../lib/credit-bonus";
import { creditsFor, quoteTopUp, type TopUpRefusal } from "../../../lib/credit-top-up-quote";
import { grossUpForFee, type ProcessorFee } from "../../../lib/pricing";
import { useCreditOptions } from "../../../lib/use-store-price";
import { CampaignBanner } from "./CampaignBanner";
import { PackageCards, type CreditPackageOffer } from "./PackageCards";

const PATH = "/store/credits";

/** One installed gateway, as `/store/payment-providers` describes it. */
interface PaymentProvider {
    id: string;
    label: string;
    description?: string;
    fee?: ProcessorFee | null;
    unavailable?: string;
}

export default function LoadCreditsPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();
    const { status } = useSession();
    const outcome = useSearchParams()?.get("credits") ?? "";
    const { format: money, code: currency } = useSiteCurrency();
    const [reloadKey, setReloadKey] = useState(0);
    const { options, failed: optionsFailed } = useCreditOptions(reloadKey);
    const [packages, setPackages] = useState<CreditPackageOffer[]>([]);
    const [packagesFailed, setPackagesFailed] = useState(false);
    const [providers, setProviders] = useState<PaymentProvider[] | null>(null);
    const [providersFailed, setProvidersFailed] = useState(false);
    const [provider, setProvider] = useState("");
    const [balance, setBalance] = useState<number | null>(null);
    const [typed, setTyped] = useState("");
    const [buying, setBuying] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (status === "unauthenticated") router.replace(`/auth/login?callbackUrl=${encodeURIComponent(PATH)}`);
    }, [status, router]);

    useEffect(() => {
        if (status !== "authenticated") return;
        let cancelled = false;
        setPackagesFailed(false);
        setProvidersFailed(false);
        fetch(`/api/v1/store/credit-packages?locale=${encodeURIComponent(locale)}`)
            .then((res) => { if (!res.ok) throw new Error("load failed"); return res.json(); })
            .then((data) => { if (!cancelled) setPackages(Array.isArray(data?.packages) ? data.packages : []); })
            .catch(() => { if (!cancelled) setPackagesFailed(true); });
        // Unanswered is not "no payment methods": that sentence tells the
        // buyer the shop cannot take money, which is not what happened.
        fetch("/api/v1/store/payment-providers")
            .then((res) => { if (!res.ok) throw new Error("load failed"); return res.json(); })
            .then((data) => {
                if (cancelled) return;
                const usable = (Array.isArray(data?.providers) ? data.providers : []).filter((p: PaymentProvider) => !p.unavailable);
                setProviders(usable);
                setProvider((prev) => prev || usable[0]?.id || "");
            })
            .catch(() => { if (!cancelled) setProvidersFailed(true); });
        // The balance is a courtesy line; without it the form still works.
        fetch("/api/v1/credits")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (!cancelled && data?.balance !== undefined) setBalance(Number(data.balance)); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [status, locale, reloadKey]);

    // The countdown, and the moment a campaign stops being offered. Once a
    // minute is as fine as it is drawn.
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const limits = options?.topUp ?? null;
    const live = useMemo(
        () => (options?.bonusCampaigns ?? []).filter((campaign) => new Date(campaign.endsAt).getTime() > now),
        [options, now],
    );
    // The server sent only running campaigns; the start is not needed here,
    // only the end, which is checked on this clock.
    const campaigns = useMemo<BonusCampaign[]>(
        () => live.map((campaign) => ({
            id: campaign.id,
            name: "",
            startsAt: new Date(0),
            endsAt: new Date(campaign.endsAt),
            isActive: true,
            tiers: campaign.tiers,
        })),
        [live],
    );

    const amount = Number(typed.replace(",", "."));
    const quote = limits && typed.trim() !== "" && Number.isFinite(amount) && amount > 0
        ? quoteTopUp(creditsFor(amount, limits.pricePerUnit), limits, campaigns, new Date(now))
        : null;
    const fee = (providers ?? []).find((p) => p.id === provider)?.fee ?? null;
    const charge = quote && fee ? grossUpForFee(quote.paid, fee) : null;
    const numberTag = dateLocaleTag(locale);
    const count = (n: number) => n.toLocaleString(numberTag);

    const refusalText = (refusal: TopUpRefusal) =>
        refusal.code === "credit_top_up_below_min"
            ? t("topUp_belowMin", { amount: money(refusal.min) })
            : refusal.code === "credit_top_up_above_max"
                ? t("topUp_aboveMax", { amount: money(refusal.max) })
                : t("topUp_presetOnly");

    const buy = async (body: { amount?: number; packageId?: string }, key: string) => {
        setBuying(key);
        try {
            const res = await fetch("/api/v1/store/credits/buy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...body, ...(provider ? { provider } : {}) }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.redirect) {
                // A limit refusal carries the limit; the message is written
                // here, where the reader's language and currency are known.
                const limit = data?.code === "credit_top_up_below_min" || data?.code === "credit_top_up_above_max" || data?.code === "credit_top_up_typed_off"
                    ? refusalText(data as TopUpRefusal)
                    : null;
                toast.error(limit ?? errorMessage(data, t("topUp_failed"), t));
                return;
            }
            // The gateway's own page. Credits arrive when it settles, never here.
            window.location.href = data.redirect;
        } catch {
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setBuying(null);
        }
    };

    const frame = { title: t("topUp_title"), description: t("topUp_subtitle"), trail: [{ label: t("title"), href: "/store" }] };

    if (optionsFailed && !limits) {
        return (
            <ArrangedClientPage page="store.credits" frame={frame} blocks={{}}>
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            </ArrangedClientPage>
        );
    }

    if (status !== "authenticated" || !limits) {
        return (
            <ArrangedClientPage page="store.credits" frame={frame} blocks={{}}>
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
            </ArrangedClientPage>
        );
    }

    const methods = providers ?? [];
    const noMethods = methods.length === 0;

    return (
        <ArrangedClientPage
            page="store.credits"
            frame={frame}
            blocks={{
                amount: () => (
                    <Card>
                        <CardHeader><CardTitle>{t("topUp_amountTitle")}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {outcome === "purchased" && <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">{t("topUp_purchased")}</p>}
                            {outcome === "cancelled" && <p role="status" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{t("topUp_cancelled")}</p>}
                            {balance !== null && (
                                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Wallet className="h-4 w-4" aria-hidden="true" />
                                    {t("topUp_balance", { amount: count(balance) })}
                                </p>
                            )}
                            <CampaignBanner campaigns={live} now={now} />

                            {limits.presets.length > 0 && (
                                <div className="flex flex-wrap gap-2" role="group" aria-label={t("topUp_presets")}>
                                    {limits.presets.map((preset) => (
                                        <Button
                                            key={preset}
                                            type="button"
                                            size="sm"
                                            variant={amount === preset ? "default" : "outline"}
                                            aria-pressed={amount === preset}
                                            onClick={() => setTyped(String(preset))}
                                        >
                                            {money(preset)}
                                        </Button>
                                    ))}
                                </div>
                            )}

                            {limits.typed && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="top-up-amount">{t("topUp_amountLabel", { currency })}</Label>
                                    <Input
                                        id="top-up-amount"
                                        type="number"
                                        inputMode={limits.cents ? "decimal" : "numeric"}
                                        min={limits.min}
                                        max={limits.max}
                                        step={limits.cents ? "0.01" : "1"}
                                        value={typed}
                                        onChange={(event) => setTyped(event.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">{t("topUp_limits", { min: money(limits.min), max: money(limits.max) })}</p>
                                </div>
                            )}

                            {quote && (
                                <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
                                    <div className="flex justify-between"><span>{t("topUp_youGet")}</span><span className="font-semibold">{t("topUp_credits", { count: quote.credits })}</span></div>
                                    {quote.bonus && (
                                        <div className="flex justify-between text-success">
                                            <span>{t("topUp_bonusLine", { percent: quote.bonus.percent })}</span>
                                            <span className="font-semibold">+{count(quote.bonus.credits)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between"><span>{t("topUp_youPay")}</span><span className="font-semibold">{money(quote.paid)}</span></div>
                                    {charge && charge.surcharge > 0 && (
                                        <>
                                            <div className="flex justify-between text-muted-foreground"><span>{t("paymentFee")}</span><span>+{money(charge.surcharge)}</span></div>
                                            <div className="flex justify-between font-semibold"><span>{t("amountToPay")}</span><span>{money(charge.charged)}</span></div>
                                        </>
                                    )}
                                    {quote.next && !quote.refusal && (
                                        <p className="pt-1 text-primary">{t("topUp_nudge", { amount: money(quote.next.missing), percent: quote.next.percent })}</p>
                                    )}
                                    {quote.refusal && <p role="alert" className="pt-1 text-destructive">{refusalText(quote.refusal)}</p>}
                                </div>
                            )}

                            {methods.length > 1 && (
                                <fieldset className="space-y-2">
                                    <legend className="text-sm font-medium">{t("paymentMethod")}</legend>
                                    {methods.map((method) => (
                                        <RadioField
                                            key={method.id}
                                            name="top-up-method"
                                            value={method.id}
                                            checked={provider === method.id}
                                            onChange={() => setProvider(method.id)}
                                            label={method.label}
                                            description={method.fee
                                                ? t("paymentFeeTerms", { percent: method.fee.percent, fixed: money(method.fee.fixed) })
                                                : method.description}
                                        />
                                    ))}
                                </fieldset>
                            )}
                            {providersFailed
                                ? <LoadFailed className="py-4" onRetry={() => setReloadKey((k) => k + 1)} />
                                : providers !== null && noMethods && <p className="text-sm text-muted-foreground">{t("noPaymentMethods")}</p>}

                            <Button
                                className="w-full"
                                disabled={!quote || quote.refusal !== null || quote.credits <= 0 || noMethods || buying !== null}
                                onClick={() => quote && buy({ amount: quote.credits }, "typed")}
                            >
                                {buying === "typed" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                                {t("topUp_buy")}
                            </Button>
                        </CardContent>
                    </Card>
                ),
                packages: () => packages.length === 0 && !packagesFailed ? null : (
                    <Card>
                        <CardHeader><CardTitle>{t("topUp_packages")}</CardTitle></CardHeader>
                        <CardContent>
                            {packagesFailed ? <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} /> : <PackageCards
                                packages={packages}
                                campaignLive={live.length > 0}
                                buying={buying}
                                disabled={noMethods}
                                onBuy={(id) => buy({ packageId: id }, id)}
                            />}
                        </CardContent>
                    </Card>
                ),
            }}
        />
    );
}
