"use client";

import { useTranslations } from "next-intl";
import { Check, Minus, X } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, buttonClassName, useSiteCurrency } from "@/core/sdk/ui";

/**
 * A comparison, drawn. One renderer, two doors.
 *
 * A table has its own page and a shelf drawn as a comparison shows the same
 * thing in place; before this there were two tables in the product doing the
 * same job in two modules, and each had the half the other lacked - one had
 * live products in its header and guessed its rows from prose, the other had
 * real rows and a header of typed words with no price on it. This is both
 * halves, once.
 *
 * Three marks, not two. A tick is a claim, a cross is a claim, and a dash is
 * the absence of one - which is what a cell nobody filled in means. Drawing a
 * cross there tells somebody deciding what to pay for that a thing lacks a
 * feature nobody ever said either way.
 *
 * The header is a price block when the column is something for sale, and a
 * name when it is not. Both come from the same place: whoever owns the column
 * answers, and what it answers with decides what is drawn.
 */

export interface GridCell {
    columnId: string;
    kind: "yes" | "no" | "value" | "unstated";
    value: string | null;
}

export interface GridColumn {
    id: string;
    label: string;
    subtitle: string | null;
    href: string | null;
    highlight: boolean;
    image: string | null;
    /** What this reader pays. */
    price: number | null;
    /** The list price, when it is on sale. */
    was: number | null;
    /** What somebody with no history pays. */
    fullPrice: number | null;
    note: string | null;
    buyHref: string | null;
}

export interface GridTable {
    title: string;
    description: string | null;
    columns: GridColumn[];
    groups: { id: string | null; label: string | null; rows: { id: string; label: string; cells: GridCell[] }[] }[];
}

function Mark({ cell, says }: { cell: GridCell; says: (kind: GridCell["kind"]) => string }) {
    if (cell.kind === "value") return <span className="text-sm font-medium">{cell.value}</span>;
    if (cell.kind === "yes") return <Check className="mx-auto h-5 w-5 text-success" aria-label={says("yes")} />;
    if (cell.kind === "no") return <X className="mx-auto h-5 w-5 text-destructive" aria-label={says("no")} />;
    // Neither a tick nor a cross: nobody said.
    return <Minus className="mx-auto h-5 w-5 text-muted-foreground/60" aria-label={says("unstated")} />;
}

/** How much off, when a column is on sale. Whole percent; nobody reads 23.4%. */
function discount(price: number, was: number): number {
    return Math.round(((was - price) / was) * 100);
}

export function ComparisonGrid({ table }: { table: GridTable }) {
    const t = useTranslations("comparisonTable");
    const { format: money } = useSiteCurrency();
    const highlighted = new Set(table.columns.filter((column) => column.highlight).map((column) => column.id));

    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead>
                    <tr className="border-b border-border">
                        <th scope="col" className="px-6 py-4 text-left text-sm font-medium text-muted-foreground">
                            {t("feature")}
                        </th>
                        {table.columns.map((column) => {
                            // Two different reasons for a lower number, drawn
                            // differently on purpose. A sale is a percentage
                            // off for everybody and earns the badge; a personal
                            // credit is a line of explanation and does not.
                            // Folding them together advertised 39% off a rank
                            // that was 17% off with a credit under it.
                            const full = column.fullPrice ?? column.price;
                            const onSale = full !== null && column.was !== null && column.was > full;
                            const credited = column.price !== null && full !== null && full > column.price;
                            const struck = credited ? full : column.was;
                            const name = (
                                <span className="block font-semibold text-foreground">{column.label}</span>
                            );
                            return (
                                <th
                                    key={column.id}
                                    scope="col"
                                    className={`px-4 py-5 text-center align-bottom ${column.highlight ? "bg-primary/5" : ""}`}
                                >
                                    {column.image && (
                                        <span className="relative mx-auto mb-2 block w-24">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={column.image} alt="" className="aspect-card w-full rounded-lg object-cover" />
                                            {onSale && (
                                                <Badge tone="danger" solid className="absolute -right-2 -top-2">
                                                    {discount(full as number, column.was as number)}%
                                                </Badge>
                                            )}
                                        </span>
                                    )}
                                    {column.href ? (
                                        <Link href={column.href} className="hover:text-primary">{name}</Link>
                                    ) : name}
                                    {column.subtitle && (
                                        <span className="block text-xs text-muted-foreground">{column.subtitle}</span>
                                    )}
                                    {column.price !== null && (
                                        <span className="mt-1 block text-sm">
                                            {struck !== null && struck > column.price && (
                                                <span className="mr-1 text-muted-foreground line-through">
                                                    {money(struck)}
                                                </span>
                                            )}
                                            <span className="font-bold text-foreground">{money(column.price)}</span>
                                        </span>
                                    )}
                                    {/* Printed as given. The module that owns
                                        the column wrote it, in the reader's
                                        language; a table that reinterprets it
                                        is a table guessing at somebody else's
                                        meaning. */}
                                    {column.note && (
                                        <span className="mt-0.5 block text-xs text-success">{column.note}</span>
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                {table.groups.map((group) => (
                    <tbody key={group.id ?? "ungrouped"}>
                        {group.label && (
                            <tr className="bg-muted/50">
                                <th
                                    scope="colgroup"
                                    colSpan={table.columns.length + 1}
                                    className="px-6 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                >
                                    {group.label}
                                </th>
                            </tr>
                        )}
                        {group.rows.map((row) => (
                            <tr key={row.id} className="border-b border-border/50">
                                <th scope="row" className="px-6 py-3 text-left text-sm font-normal">{row.label}</th>
                                {row.cells.map((cell) => (
                                    <td
                                        key={cell.columnId}
                                        className={`px-4 py-3 text-center ${highlighted.has(cell.columnId) ? "bg-primary/5" : ""}`}
                                    >
                                        <Mark cell={cell} says={(kind) => t(`mark_${kind}`)} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                ))}
                <tfoot>
                    <tr>
                        <td className="px-6 py-4" />
                        {table.columns.map((column) => {
                            const href = column.buyHref ?? column.href;
                            return (
                                <td key={column.id} className={`px-4 py-4 text-center ${column.highlight ? "bg-primary/5" : ""}`}>
                                    {href && (
                                        <Link href={href} className={buttonClassName("default", "sm")}>
                                            {/* "Buy" where there is a price, "Choose" where there is
                                                not: a table of plans that are not for sale here
                                                should not put a shop's word on its footer. */}
                                            {column.price !== null ? t("buy") : t("choose")}
                                        </Link>
                                    )}
                                </td>
                            );
                        })}
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}
