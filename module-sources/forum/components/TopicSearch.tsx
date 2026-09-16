"use client";

import { useState } from "react";
import { useRouter } from "@/core/sdk/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/core/sdk/ui";
import { Search } from "lucide-react";

/**
 * The search box, which puts what it is given in the address.
 *
 * It used to filter a list this page had fetched into client state, so a
 * search had no address and the board had no link to a single topic in the
 * HTML the server sent. The board is written by the server now, and a search
 * is another one of its addresses.
 */
export function TopicSearch({ initial, categorySlug }: { initial: string; categorySlug?: string }) {
    const t = useTranslations("forum");
    const router = useRouter();
    const [value, setValue] = useState(initial);

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const query = new URLSearchParams();
        if (categorySlug) query.set("category", categorySlug);
        if (value.trim()) query.set("search", value.trim());
        const qs = query.toString();
        router.push(qs ? `/forum?${qs}` : "/forum");
    };

    return (
        <form onSubmit={submit} className="relative w-full mb-6" role="search">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("searchTopics")}
                aria-label={t("searchTopics")}
                className="pl-10"
            />
        </form>
    );
}
