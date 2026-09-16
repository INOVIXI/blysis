"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/core/sdk/ui";
import { Download } from "lucide-react";

/**
 * The one thing on this row the server cannot write: it asks for a link that
 * is issued per request and opens it.
 *
 * The count beside it moves locally afterwards so the row reflects the press
 * without a reload; the page's own number comes from the server next visit.
 */
export function DownloadButton({ id }: { id: string }) {
    const t = useTranslations("downloads");
    const [busy, setBusy] = useState(false);

    return (
        <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
                setBusy(true);
                try {
                    const res = await fetch(`/api/v1/downloads/${id}`);
                    if (!res.ok) return;
                    const data = await res.json();
                    window.open(data.url, "_blank");
                } finally {
                    setBusy(false);
                }
            }}
        >
            <Download className="w-4 h-4" aria-hidden="true" /> {t("downloadAction")}
        </Button>
    );
}
