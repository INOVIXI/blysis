"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, CardContent, LoadFailed, useLocalDate, SegmentedTabs } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Coins, Gift, Loader2, PartyPopper, Timer } from "lucide-react";
import { errorMessage } from "@/core/sdk";
import { inkFor } from "../../lib/wheels";

/**
 * The wheels a site runs, and the one this reader is looking at.
 *
 * The old page drew a 320px canvas with the prize names written around it in
 * 10px type, which on a phone was a grey disc with smudges on it, and it knew
 * about exactly one wheel because that is all there was. A site can run
 * several now - a free daily one, a weekly one for a rank, one that costs
 * credits - so the page picks between them and says, for each, whether this
 * reader may turn it and when.
 *
 * The wheel itself is SVG rather than canvas: it scales to the screen it is
 * on, the labels are text a screen reader can read, and the turn is one CSS
 * transition rather than an animation loop.
 */

interface Prize {
    id: string;
    name: string;
    type: string;
    value: number;
    color: string;
}

type Refusal = "signed_out" | "wheel_off" | "wrong_role" | "too_soon" | "not_enough_credits" | null;

interface Wheel {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    cost: number;
    cooldown: string;
    cooldownHours: number;
    restricted: boolean;
    prizes: Prize[];
    canTurn: boolean;
    refusal: Refusal;
    nextTurnAt: string | null;
}

/** Where the pointer sits, in degrees clockwise from the top. */
const POINTER_AT = 0;
/** Full turns before the wheel settles, so a turn reads as a turn. */
const FLOURISH = 6;

/**
 * The wheel, in the 200-unit box it is drawn in.
 *
 * A rim rather than a bare pie: the slices stop short of the edge and a ring
 * with a peg on every seam sits in the gap, which is what makes it read as a
 * thing that turns rather than a chart. The hub covers where the seams meet,
 * because seven lines converging on a point is the one place the drawing
 * looks unfinished.
 */
const WHEEL = { centre: 100, slices: 88, rim: 92, edge: 96, hub: 17, label: 82 };

function polarToCartesian(cx: number, cy: number, radius: number, degrees: number) {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

/** One slice of the wheel, as an SVG path. */
function slicePath(cx: number, cy: number, radius: number, from: number, to: number): string {
    const start = polarToCartesian(cx, cy, radius, to);
    const end = polarToCartesian(cx, cy, radius, from);
    const large = to - from <= 180 ? "0" : "1";
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 0 ${end.x} ${end.y} Z`;
}

/**
 * Where a prize's name goes, and which way up.
 *
 * The labels used to lie across their slice and be rotated with it, so every
 * name on the bottom half of the wheel was upside down - a third of them, on
 * every wheel, unreadable without turning your head. They read along the
 * radius now, and the ones past the bottom are turned the other way and
 * anchored at their other end, which puts them the same way up in the same
 * place.
 */
function labelAt(mid: number) {
    const flipped = mid > 180;
    const at = polarToCartesian(WHEEL.centre, WHEEL.centre, WHEEL.label, mid);
    return {
        x: at.x,
        y: at.y,
        anchor: (flipped ? "start" : "end") as "start" | "end",
        turn: `rotate(${flipped ? mid + 90 : mid - 90} ${at.x} ${at.y})`,
    };
}

/** As many characters as fit between the hub and the rim at this size. */
function short(name: string): string {
    return name.length > 18 ? `${name.slice(0, 17)}\u2026` : name;
}

export default function WheelPage() {
    const t = useTranslations("wheel");
    const commonT = useTranslations("common");
    const { data: session } = useSession();
    const formatLocalDate = useLocalDate();

    const [wheels, setWheels] = useState<Wheel[]>([]);
    const [activeSlug, setActiveSlug] = useState<string | null>(null);
    const [credits, setCredits] = useState(0);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [turning, setTurning] = useState(false);
    const [rotation, setRotation] = useState(0);
    // `index` is which slice it landed on, which the wheel needs twice: to
    // stop with it under the pointer, and to leave it lit while the rest dim.
    const [result, setResult] = useState<
        { name: string; type: string; value: number; code?: string | null; index: number } | null
    >(null);
    const [refused, setRefused] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/wheel/wheels")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                const rows: Wheel[] = d.wheels ?? [];
                setWheels(rows);
                setCredits(Number(d.credits ?? 0));
                setActiveSlug((current) => current && rows.some((w) => w.slug === current) ? current : rows[0]?.slug ?? null);
                setFailed(false);
                setLoading(false);
            })
            .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const wheel = useMemo(
        () => wheels.find((w) => w.slug === activeSlug) ?? wheels[0] ?? null,
        [wheels, activeSlug],
    );

    const turn = async () => {
        if (!wheel || turning) return;
        setTurning(true);
        setResult(null);
        setRefused(null);
        try {
            const res = await fetch(`/api/v1/wheel/spin?wheel=${encodeURIComponent(wheel.slug)}`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) {
                setRefused(t.has(`refusal_${data.code ?? ""}`) ? t(`refusal_${data.code}`) : errorMessage(data, commonT("somethingWentWrong"), commonT));
                setTurning(false);
                return;
            }

            // Stop with the winning slice under the pointer, after a few whole
            // turns so it reads as a wheel rather than a jump.
            const slices = wheel.prizes.length;
            const sliceAngle = 360 / slices;
            const target = 360 * FLOURISH + (POINTER_AT - (data.prize.index * sliceAngle + sliceAngle / 2));
            setRotation((previous) => previous + ((target - (previous % 360)) % 360) + 360 * FLOURISH);

            // The slice has to arrive before the announcement does.
            window.setTimeout(() => {
                setResult(data.prize);
                setTurning(false);
                setReloadKey((k) => k + 1);
            }, 4200);
        } catch {
            setRefused(commonT("somethingWentWrong"));
            setTurning(false);
        }
    };

    const cooldownLabel = (w: Wheel) =>
        w.cooldown === "custom" ? t("cooldown_customEvery", { hours: w.cooldownHours }) : t(`cooldown_${w.cooldown}`);

    const refusalLabel = (w: Wheel) => {
        if (!w.refusal) return null;
        if (w.refusal === "too_soon" && w.nextTurnAt) {
            return t("refusal_wheel_too_soon_at", { when: formatLocalDate(w.nextTurnAt) });
        }
        return t.has(`refusal_wheel_${w.refusal}`) ? t(`refusal_wheel_${w.refusal}`) : null;
    };

    return (
        <PageFrame
            title={t("title")}
            description={t("description")}
            sidebar={wheel ? (
                <div className="space-y-5">
                    <div className="bg-card rounded-xl border border-border p-5">
                        <h2 className="font-bold text-foreground mb-3">{t("thisWheel")}</h2>
                        <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">{t("howOften")}</dt>
                                <dd className="text-foreground text-right">{cooldownLabel(wheel)}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">{t("costsPerTurn")}</dt>
                                <dd className="text-foreground text-right">
                                    {wheel.cost > 0 ? t("credits", { count: wheel.cost }) : t("free")}
                                </dd>
                            </div>
                            {session?.user && (
                                <div className="flex justify-between gap-3">
                                    <dt className="text-muted-foreground">{t("yourCredits")}</dt>
                                    <dd className="text-foreground text-right">{credits}</dd>
                                </div>
                            )}
                        </dl>
                    </div>

                    {wheel.prizes.length > 0 && (
                    <div className="bg-card rounded-xl border border-border p-5">
                        <h2 className="font-bold text-foreground mb-3">{t("whatIsOnIt")}</h2>
                        <ul className="space-y-2 text-sm">
                            {wheel.prizes.map((prize) => (
                                <li key={prize.id} className="flex items-center gap-2">
                                    <span
                                        className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                                        style={{ backgroundColor: prize.color }}
                                        aria-hidden="true"
                                    />
                                    <span className="text-foreground">{prize.name}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    )}
                </div>
            ) : null}
        >
            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : wheels.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("noWheels")}</CardContent></Card>
            ) : (
                <Card>
                    {wheels.length > 1 && (
                        /* Inside the card rather than above it: a control row
                           above the panel pushes the first card down a row,
                           which leaves every widget beside it floating that
                           much higher than the thing it sits next to. */
                        <SegmentedTabs
                            label={t("pickAWheel")}
                            activeId={wheel?.slug ?? ""}
                            onChange={(slug) => { setActiveSlug(slug); setResult(null); setRefused(null); }}
                            className="px-2"
                            tabs={wheels.map((w) => ({
                                id: w.slug,
                                label: w.name,
                                icon: w.restricted ? "Lock" : null,
                                trailing: w.cost > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-xs opacity-80">
                                        <Coins className="w-3 h-3" aria-hidden="true" />{w.cost}
                                    </span>
                                ) : null,
                            }))}
                        />
                    )}

                    {wheel && wheel.prizes.length === 0 && (
                        <CardContent className="py-12 text-center text-muted-foreground">
                            <Gift className="w-8 h-8 mx-auto mb-3 opacity-40" aria-hidden="true" />
                            <p>{t("refusal_wheel_no_prizes")}</p>
                        </CardContent>
                    )}

                    {wheel && wheel.prizes.length > 0 && (
                        <CardContent className="p-6">
                            <div className="flex flex-col items-center gap-6">
                                {wheel.description && (
                                    <p className="max-w-md text-center text-muted-foreground">{wheel.description}</p>
                                )}

                                <div className="relative w-full max-w-[420px] aspect-square">
                                    {/* Over the wheel rather than on it, so it
                                        stays put while the wheel turns under
                                        it. It overlaps the rim by a couple of
                                        units: a pointer with daylight under it
                                        is not pointing at anything. */}
                                    <svg
                                        viewBox="0 0 200 200"
                                        className="absolute inset-0 z-10 h-full w-full"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d="M 100 22 L 90 0 L 110 0 Z"
                                            fill="var(--color-primary)"
                                            stroke="var(--color-card)"
                                            strokeWidth="2"
                                            strokeLinejoin="round"
                                        />
                                    </svg>

                                    <svg
                                        viewBox="0 0 200 200"
                                        className="h-full w-full"
                                        style={{
                                            transform: `rotate(${rotation}deg)`,
                                            transition: turning ? "transform 4s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
                                        }}
                                        role="img"
                                        aria-label={t("wheelWith", { count: wheel.prizes.length })}
                                    >
                                        {/* The rim, drawn first so the slices
                                            sit inside it, and given an edge of
                                            its own: an unbounded pale ring
                                            reads as a margin rather than as
                                            part of the wheel. */}
                                        <circle
                                            cx={WHEEL.centre}
                                            cy={WHEEL.centre}
                                            r={WHEEL.edge}
                                            fill="var(--color-muted)"
                                            stroke="var(--color-border)"
                                            strokeWidth="1"
                                        />

                                        {wheel.prizes.map((prize, index) => {
                                            const slice = 360 / wheel.prizes.length;
                                            const from = index * slice;
                                            const mid = from + slice / 2;
                                            const label = labelAt(mid);
                                            const won = result?.index === index;
                                            // Only once a prize has landed:
                                            // dimming the others before there
                                            // is a winner dims all of them.
                                            const faded = result !== null && !won;
                                            return (
                                                <g key={prize.id} opacity={faded ? 0.45 : 1}>
                                                    <path
                                                        d={slicePath(WHEEL.centre, WHEEL.centre, WHEEL.slices, from, from + slice)}
                                                        fill={prize.color}
                                                    />
                                                    <text
                                                        x={label.x}
                                                        y={label.y}
                                                        fill={inkFor(prize.color) === "dark" ? "#111827" : "#ffffff"}
                                                        fontSize="7"
                                                        fontWeight="600"
                                                        textAnchor={label.anchor}
                                                        dominantBaseline="middle"
                                                        transform={label.turn}
                                                    >
                                                        {short(prize.name)}
                                                    </text>
                                                </g>
                                            );
                                        })}

                                        {/* A peg on every seam, on the rim.
                                            They are what the eye counts, and
                                            what the pointer appears to click
                                            past on the way round. */}
                                        {wheel.prizes.map((prize, index) => {
                                            const at = polarToCartesian(
                                                WHEEL.centre,
                                                WHEEL.centre,
                                                WHEEL.rim,
                                                index * (360 / wheel.prizes.length),
                                            );
                                            return (
                                                <circle
                                                    key={`peg-${prize.id}`}
                                                    cx={at.x}
                                                    cy={at.y}
                                                    r="2"
                                                    fill="var(--color-border)"
                                                />
                                            );
                                        })}

                                        {/* Where the slices end. Without it
                                            the colours fade into the rim and
                                            the wheel has no edge. */}
                                        <circle
                                            cx={WHEEL.centre}
                                            cy={WHEEL.centre}
                                            r={WHEEL.slices}
                                            fill="none"
                                            stroke="var(--color-border)"
                                            strokeWidth="1"
                                        />

                                        <circle
                                            cx={WHEEL.centre}
                                            cy={WHEEL.centre}
                                            r={WHEEL.hub}
                                            fill="var(--color-card)"
                                            stroke="var(--color-border)"
                                            strokeWidth="2"
                                        />
                                        <circle
                                            cx={WHEEL.centre}
                                            cy={WHEEL.centre}
                                            r="4"
                                            fill="var(--color-primary)"
                                        />
                                    </svg>
                                </div>

                                {result ? (
                                    <div className="text-center space-y-2" role="status">
                                        <PartyPopper className="w-8 h-8 text-primary mx-auto" aria-hidden="true" />
                                        <p className="text-lg font-bold text-foreground">{result.name}</p>
                                        {result.code && (
                                            <p className="text-sm text-muted-foreground">
                                                {t("couponCode")}: <span className="font-mono text-foreground">{result.code}</span>
                                            </p>
                                        )}
                                    </div>
                                ) : refused ? (
                                    <p role="alert" className="text-center text-sm text-destructive">{refused}</p>
                                ) : null}

                                <div className="flex flex-col items-center gap-2">
                                    <Button size="lg" onClick={turn} disabled={turning || !wheel.canTurn}>
                                        {turning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                                        {wheel.cost > 0 ? t("turnForCredits", { count: wheel.cost }) : t("turn")}
                                    </Button>
                                    {!wheel.canTurn && refusalLabel(wheel) && (
                                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                            {wheel.refusal === "too_soon" ? <Timer className="w-3.5 h-3.5" aria-hidden="true" /> : null}
                                            {refusalLabel(wheel)}
                                        </p>
                                    )}
                                    {wheel.restricted && (
                                        <Badge tone="info">{t("membersOnly")}</Badge>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    )}
                </Card>
            )}
        </PageFrame>
    );
}
