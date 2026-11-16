/**
 * A product's variants as the form holds them and as the API takes them.
 *
 * The numbers are text while they are being typed, as every other price box
 * on the form is, and become numbers only on the way out. An empty name or
 * command line is dropped there rather than refused: it is a row the operator
 * added and did not fill in.
 */
import { originalText, type TranslatableText } from "@/core/sdk";

export interface VariantCommandDraft {
    command: string;
    serverId: string;
    target: "server" | "player";
    whenOnline: boolean;
}

export interface VariantDraft {
    /** Missing on a variant not saved yet; the server makes it. */
    id?: string;
    label: TranslatableText;
    price: string;
    units: string;
    durationDays: string;
    variables: { name: string; value: string }[];
    commands: VariantCommandDraft[];
    isActive: boolean;
}

export function emptyVariant(): VariantDraft {
    return { label: "", price: "", units: "1", durationDays: "", variables: [], commands: [], isActive: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The drafts for what the product holds now. */
export function variantDraftsFrom(raw: unknown): VariantDraft[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRecord).map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : undefined,
        label: (typeof entry.label === "string" || isRecord(entry.label) ? entry.label : "") as TranslatableText,
        price: entry.price === undefined || entry.price === null ? "" : String(entry.price),
        units: typeof entry.units === "number" ? String(entry.units) : "1",
        durationDays: typeof entry.durationDays === "number" ? String(entry.durationDays) : "",
        variables: isRecord(entry.variables)
            ? Object.entries(entry.variables).map(([name, value]) => ({ name, value: String(value) }))
            : [],
        commands: Array.isArray(entry.commands)
            ? entry.commands.filter(isRecord).map((command) => ({
                  command: typeof command.command === "string" ? command.command : "",
                  serverId: typeof command.serverId === "string" ? command.serverId : "",
                  target: command.target === "player" ? ("player" as const) : ("server" as const),
                  whenOnline: command.whenOnline !== false,
              }))
            : [],
        isActive: entry.isActive !== false,
    }));
}

/** What the API takes; a variant with no name is one nobody finished. */
export function variantsPayload(drafts: VariantDraft[]) {
    return drafts
        .filter((draft) => originalText(draft.label).trim() !== "")
        .map((draft) => ({
            ...(draft.id ? { id: draft.id } : {}),
            label: draft.label,
            price: Number(draft.price) || 0,
            units: Math.max(1, Math.trunc(Number(draft.units) || 1)),
            durationDays: draft.durationDays.trim() === "" ? null : Math.max(1, Math.trunc(Number(draft.durationDays) || 1)),
            variables: Object.fromEntries(
                draft.variables
                    .map((entry) => [entry.name.trim(), entry.value] as const)
                    .filter(([name]) => name !== ""),
            ),
            commands: draft.commands
                .filter((entry) => entry.command.trim() !== "")
                .map((entry) => ({
                    command: entry.command.trim(),
                    serverId: entry.target === "player" ? null : entry.serverId || null,
                    target: entry.target,
                    whenOnline: entry.target === "player" ? true : entry.whenOnline,
                })),
            isActive: draft.isActive,
        }));
}
