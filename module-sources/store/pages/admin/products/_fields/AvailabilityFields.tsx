"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect } from "@/core/sdk/ui";
import { useRoles } from "./use-roles";
import { minutesFromTime } from "./time-of-day";

/**
 * When a product is for sale, on one card, on both product forms.
 *
 * Four rules an operator can set without watching a clock: a run between two
 * dates, a weekly window, a limit per person, and an allowance that refills.
 * The hours are the site's own - the label says which zone, because "18:00"
 * with no zone beside it is the thing that made somebody schedule a sale
 * three hours out.
 */

export interface AvailabilityValue {
    roleId: string;
    availableFrom: string;
    availableUntil: string;
    availableDays: number[];
    availableFrom24: string;
    availableUntil24: string;
    outsideWindow: string;
    perPersonLimit: string;
    perPersonPeriod: string;
    periodStock: string;
    periodStockWindow: string;
    salePrice: string;
    saleFrom: string;
    saleUntil: string;
}

export const EMPTY_AVAILABILITY: AvailabilityValue = {
    roleId: "",
    availableFrom: "",
    availableUntil: "",
    availableDays: [],
    availableFrom24: "",
    availableUntil24: "",
    outsideWindow: "countdown",
    perPersonLimit: "",
    perPersonPeriod: "ever",
    periodStock: "",
    periodStockWindow: "day",
    salePrice: "",
    saleFrom: "",
    saleUntil: "",
};

/** What the form sends. Empty means "no rule", never zero. */
export function availabilityPayload(value: AvailabilityValue) {
    return {
        roleId: value.roleId,
        availableFrom: value.availableFrom || null,
        availableUntil: value.availableUntil || null,
        availableDays: value.availableDays,
        availableFromMinute: minutesFromTime(value.availableFrom24),
        availableUntilMinute: minutesFromTime(value.availableUntil24),
        outsideWindow: value.outsideWindow,
        perPersonLimit: value.perPersonLimit ? Number(value.perPersonLimit) : null,
        perPersonPeriod: value.perPersonPeriod,
        periodStock: value.periodStock ? Number(value.periodStock) : null,
        periodStockWindow: value.periodStockWindow,
        salePrice: value.salePrice ? Number(value.salePrice) : null,
        saleFrom: value.saleFrom || null,
        saleUntil: value.saleUntil || null,
    };
}

interface Props {
    value: AvailabilityValue;
    onChange: (next: AvailabilityValue) => void;
    /** The zone the hours are read in, shown beside them. */
    timeZone: string;
}

export function AvailabilityFields({ value, onChange, timeZone }: Props) {
    const t = useTranslations("store");
    const set = (patch: Partial<AvailabilityValue>) => onChange({ ...value, ...patch });
    const roles = useRoles();

    const days = [0, 1, 2, 3, 4, 5, 6];
    const toggleDay = (day: number) =>
        set({
            availableDays: value.availableDays.includes(day)
                ? value.availableDays.filter((d) => d !== day)
                : [...value.availableDays, day].sort(),
        });

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("adm_availability")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("adm_availabilityHint", { zone: timeZone })}</p>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <Label htmlFor="roleId">{t("adm_whoMayBuy")}</Label>
                    <NativeSelect
                        id="roleId"
                        className="mt-1"
                        value={value.roleId}
                        onChange={(e) => set({ roleId: e.target.value })}
                    >
                        <option value="">{t("adm_whoMayBuy_everyone")}</option>
                        {roles.map((role) => (
                            <option key={role.id} value={role.id}>{role.displayName || role.name}</option>
                        ))}
                    </NativeSelect>
                    <p className="mt-1 text-xs text-muted-foreground">{t("adm_whoMayBuyHint")}</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="availableFrom">{t("adm_availableFrom")}</Label>
                        <Input
                            id="availableFrom"
                            type="datetime-local"
                            className="mt-1"
                            value={value.availableFrom}
                            onChange={(e) => set({ availableFrom: e.target.value })}
                        />
                    </div>
                    <div>
                        <Label htmlFor="availableUntil">{t("adm_availableUntil")}</Label>
                        <Input
                            id="availableUntil"
                            type="datetime-local"
                            className="mt-1"
                            value={value.availableUntil}
                            onChange={(e) => set({ availableUntil: e.target.value })}
                        />
                    </div>
                </div>

                <div>
                    <Label>{t("adm_availableDays")}</Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {days.map((day) => (
                            <button
                                key={day}
                                type="button"
                                aria-pressed={value.availableDays.includes(day)}
                                onClick={() => toggleDay(day)}
                                className={`h-9 rounded-md border px-3 text-sm transition-colors ${
                                    value.availableDays.includes(day)
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                }`}
                            >
                                {t(`adm_day_${day}`)}
                            </button>
                        ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t("adm_availableDaysHint")}</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="availableFrom24">{t("adm_availableFromHour")}</Label>
                        <Input
                            id="availableFrom24"
                            type="time"
                            className="mt-1"
                            value={value.availableFrom24}
                            onChange={(e) => set({ availableFrom24: e.target.value })}
                        />
                    </div>
                    <div>
                        <Label htmlFor="availableUntil24">{t("adm_availableUntilHour")}</Label>
                        <Input
                            id="availableUntil24"
                            type="time"
                            className="mt-1"
                            value={value.availableUntil24}
                            onChange={(e) => set({ availableUntil24: e.target.value })}
                        />
                    </div>
                </div>

                <div>
                    <Label htmlFor="outsideWindow">{t("adm_outsideWindow")}</Label>
                    <NativeSelect
                        id="outsideWindow"
                        className="mt-1"
                        value={value.outsideWindow}
                        onChange={(e) => set({ outsideWindow: e.target.value })}
                    >
                        <option value="countdown">{t("adm_outsideWindow_countdown")}</option>
                        <option value="hidden">{t("adm_outsideWindow_hidden")}</option>
                    </NativeSelect>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="perPersonLimit">{t("adm_perPersonLimit")}</Label>
                        <Input
                            id="perPersonLimit"
                            type="number"
                            min="1"
                            className="mt-1"
                            placeholder={t("adm_noLimit")}
                            value={value.perPersonLimit}
                            onChange={(e) => set({ perPersonLimit: e.target.value })}
                        />
                    </div>
                    <div>
                        <Label htmlFor="perPersonPeriod">{t("adm_perPersonPeriod")}</Label>
                        <NativeSelect
                            id="perPersonPeriod"
                            className="mt-1"
                            value={value.perPersonPeriod}
                            onChange={(e) => set({ perPersonPeriod: e.target.value })}
                        >
                            <option value="ever">{t("adm_period_ever")}</option>
                            <option value="day">{t("adm_period_day")}</option>
                            <option value="week">{t("adm_period_week")}</option>
                            <option value="month">{t("adm_period_month")}</option>
                        </NativeSelect>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="periodStock">{t("adm_periodStock")}</Label>
                        <Input
                            id="periodStock"
                            type="number"
                            min="1"
                            className="mt-1"
                            placeholder={t("adm_noLimit")}
                            value={value.periodStock}
                            onChange={(e) => set({ periodStock: e.target.value })}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">{t("adm_periodStockHint")}</p>
                    </div>
                    <div>
                        <Label htmlFor="periodStockWindow">{t("adm_periodStockWindow")}</Label>
                        <NativeSelect
                            id="periodStockWindow"
                            className="mt-1"
                            value={value.periodStockWindow}
                            onChange={(e) => set({ periodStockWindow: e.target.value })}
                        >
                            <option value="day">{t("adm_period_day")}</option>
                            <option value="week">{t("adm_period_week")}</option>
                            <option value="month">{t("adm_period_month")}</option>
                        </NativeSelect>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                        <Label htmlFor="salePrice">{t("adm_salePrice")}</Label>
                        <Input
                            id="salePrice"
                            type="number"
                            step="0.01"
                            min="0"
                            className="mt-1"
                            value={value.salePrice}
                            onChange={(e) => set({ salePrice: e.target.value })}
                        />
                    </div>
                    <div>
                        <Label htmlFor="saleFrom">{t("adm_saleFrom")}</Label>
                        <Input
                            id="saleFrom"
                            type="datetime-local"
                            className="mt-1"
                            value={value.saleFrom}
                            onChange={(e) => set({ saleFrom: e.target.value })}
                        />
                    </div>
                    <div>
                        <Label htmlFor="saleUntil">{t("adm_saleUntil")}</Label>
                        <Input
                            id="saleUntil"
                            type="datetime-local"
                            className="mt-1"
                            value={value.saleUntil}
                            onChange={(e) => set({ saleUntil: e.target.value })}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
