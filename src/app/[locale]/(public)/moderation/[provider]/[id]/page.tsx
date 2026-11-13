import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/core/lib/auth";
import { redirect } from "@/core/lib/i18n/navigation";
import { ArrangedPage } from "@/core/components/layout/ArrangedPage";
import { ModerationNoticeCard } from "@/core/components/moderation/ModerationNoticeCard";
import { readNotice } from "@/core/lib/moderation-notice";
import { coreScreenMetadata } from "@/core/lib/core-screens";

export const dynamic = "force-dynamic";

export const generateMetadata = coreScreenMetadata("/moderation/[provider]/[id]");

/**
 * Where the notification about a rejected post leads: what happened to it
 * and why, for its author only. Anybody else, and any item that does not
 * exist, gets the site's 404, so the address says nothing about either.
 */
export default async function ModerationNoticePage({ params }: { params: Promise<{ provider: string; id: string }> }) {
    const { provider, id } = await params;
    const locale = await getLocale();
    const session = await getSession();
    if (!session?.user?.id) {
        redirect({ href: `/auth/login?callbackUrl=${encodeURIComponent(`/moderation/${provider}/${id}`)}`, locale });
        return null;
    }

    const notice = await readNotice(provider, id, session.user.id, locale);
    if (!notice) notFound();

    const t = await getTranslations("profile");
    return (
        <ArrangedPage
            page="core.moderation"
            frame={{ title: t("moderationNotice_title"), description: t("moderationNotice_description") }}
            blocks={{ notice: () => <ModerationNoticeCard notice={notice} /> }}
        />
    );
}
