"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Turnstile widget, drawn into core's `auth.form.challenge` slot.
 *
 * Core hands us the action the form performs and an `onField` callback, and
 * knows nothing else: the field name below is Cloudflare's, not core's, and
 * a different challenge module would report a different one.
 *
 * The public config endpoint returns the site key and which forms the admin
 * turned this on for. It never returns the secret. When the module is
 * installed but unconfigured - or switched off for this particular form -
 * this renders nothing and reports no field, and the server-side listener
 * agrees, so the form works exactly as it did before.
 */
interface PublicConfig {
    siteKey: string;
    /** The forms the widget belongs on, by the id each one declared. */
    points: string[];
}

interface TurnstileApi {
    render: (
        el: HTMLElement,
        options: {
            sitekey: string;
            callback: (token: string) => void;
            "expired-callback": () => void;
            "error-callback": () => void;
            theme: "auto";
        },
    ) => string;
    remove: (id: string) => void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const FIELD = "cf-turnstile-response";

function loadScript(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    if (window.turnstile) return Promise.resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
        return new Promise((resolve) => existing.addEventListener("load", () => resolve(), { once: true }));
    }
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener("load", () => resolve(), { once: true });
        script.addEventListener("error", () => resolve(), { once: true });
        document.head.appendChild(script);
    });
}

export default function TurnstileChallenge({
    action,
    onField,
}: {
    /** The point the form declared. Core's own three, or a module's own. */
    action?: string;
    onField?: (name: string, value: string) => void;
}) {
    const [config, setConfig] = useState<PublicConfig | null>(null);
    const container = useRef<HTMLDivElement | null>(null);
    const widgetId = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/security/turnstile/public-config")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setConfig(data as PublicConfig | null);
            })
            .catch(() => {
                // Unreachable config means no widget, which is the same as
                // not being installed. The server decides whether that is
                // allowed to pass.
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Cloudflare's own reset-callback surface uses the widget id, so the
    // whole lifecycle lives in one effect keyed on the site key.
    /*
     * Drawn where the operator switched it on, whichever form that is. It
     * used to be a choice between two, with a third branch that drew the
     * widget on the forgot-password form whenever either of them was on -
     * which is a form nobody had asked to protect.
     */
    const enabled = !!config?.siteKey && !!action && (config.points ?? []).includes(action);

    useEffect(() => {
        if (!enabled || !config?.siteKey) return;
        let cancelled = false;

        void loadScript().then(() => {
            if (cancelled || !container.current || !window.turnstile) return;
            widgetId.current = window.turnstile.render(container.current, {
                sitekey: config.siteKey,
                theme: "auto",
                callback: (token: string) => onField?.(FIELD, token),
                "expired-callback": () => onField?.(FIELD, ""),
                "error-callback": () => onField?.(FIELD, ""),
            });
        });

        return () => {
            cancelled = true;
            if (widgetId.current && window.turnstile) {
                try {
                    window.turnstile.remove(widgetId.current);
                } catch {
                    // Already gone: the widget removes itself when its
                    // container leaves the document.
                }
            }
            widgetId.current = null;
            onField?.(FIELD, "");
        };
        // `onField` is a stable useCallback in core's hook.
    }, [enabled, config?.siteKey, onField]);

    if (!enabled) return null;
    return <div ref={container} className="flex justify-center" />;
}
