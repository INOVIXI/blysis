/** What `GET /api/v1/admin/ai` answers, and what the screen edits of it. */

export interface AiProviderRow {
    id: string;
    name: string;
    enabled: boolean;
    configured: boolean;
}

export interface AiPurposeRow {
    module: string;
    id: string;
    labelKey: string;
    sendsKey: string;
}

export interface AiUsageRow {
    module: string;
    purpose: string;
    requests: number;
    tokens: number;
    errors: number;
}

interface Bound {
    min: number;
    max: number;
}

export interface AiLimits {
    timeoutSeconds: number;
    dailyTokenLimit: number;
    requestsPerMinute: number;
    retentionDays: number;
    moduleTokenLimits: Record<string, number>;
}

export interface AiScreen {
    providers: AiProviderRow[];
    active: string | null;
    chosen: string | null;
    settings: AiLimits;
    bounds: Record<"timeoutSeconds" | "dailyTokenLimit" | "requestsPerMinute" | "retentionDays", Bound>;
    purposes: AiPurposeRow[];
    usage: AiUsageRow[];
    windowDays: number;
}

export interface AiDraft extends AiLimits {
    active: string | null;
}
