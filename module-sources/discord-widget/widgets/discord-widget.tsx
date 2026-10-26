"use client";

import { useState, useEffect } from "react";

export function DiscordWidget() {
    const [widgetId, setWidgetId] = useState<string | null>(null);
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        fetch("/api/v1/discord-widget")
            .then(r => r.json())
            .then(d => setWidgetId(typeof d.serverId === "string" ? d.serverId : ""))
            .catch(() => setWidgetId(""));
    }, []);

    useEffect(() => {
        // `data-mode` is always there, `light` or `dark`: asking whether it
        // was set at all drew Discord's dark widget on every light page.
        const read = () => setIsDark(document.documentElement.getAttribute("data-mode") === "dark");
        read();
        const observer = new MutationObserver(read);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
        return () => observer.disconnect();
    }, []);

    if (!widgetId) return null;

    return (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
            <iframe
                src={`https://discord.com/widget?id=${widgetId}&theme=${isDark ? "dark" : "light"}`}
                width="100%"
                height="300"
                frameBorder="0"
                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                className="rounded-xl"
            />
        </div>
    );
}
