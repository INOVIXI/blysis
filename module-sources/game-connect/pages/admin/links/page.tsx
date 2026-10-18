"use client";

/**
 * Every game account linked to a member, searchable by either name. Unlinking
 * takes nothing from either account; the player is asked to link again the
 * next time they buy in game.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Unlink } from "lucide-react";
import { Button, Card, CardContent, Checkbox, ListControls, Pagination, useConfirm, useLocalDateTime, useRowPicks } from "@/core/sdk/ui";
import { deleteEach } from "@/core/sdk";
import { AdminPageHeader, BulkBar, RowActions } from "@/core/sdk/admin";

interface Link {
    id: string;
    platform: string;
    externalId: string;
    name: string;
    member: string | null;
    linkedAt: string;
}

export default function LinksPage() {
    const t = useTranslations("gameConnect");
    const { confirm } = useConfirm();
    const when = useLocalDateTime();
    const [search, setSearch] = useState("");
    const [links, setLinks] = useState<Link[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const picks = useRowPicks(links);

    const load = useCallback(async () => {
        const query = new URLSearchParams({ page: String(page) });
        if (search.trim()) query.set("q", search.trim());
        const res = await fetch(`/api/v1/game-connect/admin/links?${query}`);
        if (res.ok) {
            const data = await res.json();
            setLinks(data.links ?? []);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 50))));
        } else toast.error(t("l_loadFailed"));
        setLoading(false);
    }, [page, search, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    const unlink = async (link: Link) => {
        const ok = await confirm({
            title: t("l_unlinkTitle"),
            message: t("l_unlinkConfirm", { player: link.name, member: link.member ?? "-" }),
            confirmText: t("l_unlink"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/game-connect/admin/links/${link.id}`, { method: "DELETE" });
        if (res.ok) toast.success(t("l_unlinked"));
        else toast.error(t("l_unlinkFailed"));
        load();
    };

    const unlinkMany = async () => {
        const ok = await confirm({
            title: t("l_unlinkTitle"),
            message: t("l_unlinkManyConfirm", { count: picks.picked.size }),
            confirmText: t("l_unlink"),
            variant: "danger",
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/game-connect/admin/links/${id}`, { method: "DELETE" });
            return res.ok;
        });
        picks.clear();
        if (deleted === total) toast.success(t("l_unlinked"));
        else toast.error(t("l_unlinkedPartly", { deleted, total }));
        load();
    };

    return (
        <>
            <AdminPageHeader title={t("l_title")} description={t("l_subtitle")} />
            <ListControls className="mb-4" search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }} />
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : links.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("l_empty")}</p>
                    ) : (
                        <>
                        <BulkBar
                            state={picks.headerState}
                            count={picks.picked.size}
                            onToggleAll={picks.toggleAll}
                            actions={
                                <Button variant="destructive" size="sm" onClick={unlinkMany}>
                                    <Unlink className="w-4 h-4" /> {t("l_unlink")} {picks.picked.size}
                                </Button>
                            }
                        />
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="w-10 py-3 px-4" />
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("l_player")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("l_member")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("l_linkedAt")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground text-sm">{t("l_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {links.map((link) => (
                                        <tr key={link.id} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <Checkbox checked={picks.picked.has(link.id)} onChange={() => picks.toggle(link.id)} aria-label={t("l_pick")} />
                                            </td>
                                            <td className="py-3 px-4">
                                                <p className="font-medium">{link.name}</p>
                                                <p className="text-xs text-muted-foreground font-mono">{link.platform} · {link.externalId}</p>
                                            </td>
                                            <td className="py-3 px-4 text-sm">{link.member ?? "-"}</td>
                                            <td className="py-3 px-4 text-sm">{when(link.linkedAt)}</td>
                                            <td className="py-3 px-4 text-right">
                                                <RowActions actions={[{ icon: Unlink, label: t("l_unlink"), onClick: () => unlink(link), destructive: true }]} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        </>
                    )}
                    <Pagination page={page} pages={pages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
