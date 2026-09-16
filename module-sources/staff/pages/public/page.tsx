/**
 * The team, written by the server.
 *
 * The page fetched its members after it had loaded, so the HTML the server
 * sent carried no name and no role: measured, 59 characters of text inside
 * `<main>`. Nothing on this page needs a browser.
 */
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { PageFrame } from "@/core/sdk/layout";
import { Card, CardContent } from "@/core/sdk/ui";
import { readStaff } from "../../lib/read-staff";

export default async function StaffPage() {
    const t = await getTranslations("staff");
    const members = await readStaff();

    return (
        <PageFrame title={t("title")} description={t("subtitle")}>
            {members.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("empty")}</CardContent></Card>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                    {members.map((member) => {
                        const avatarUrl = member.avatar || member.user?.avatar;
                        return (
                            <Card key={member.id} className="text-center hover:shadow-md transition-shadow">
                                <CardContent className="p-6">
                                    <div className="w-20 h-20 rounded-full mx-auto mb-3 bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                                        {avatarUrl ? (
                                            <Image src={avatarUrl} alt={member.name} width={80} height={80} className="w-full h-full object-cover" />
                                        ) : (
                                            member.name[0].toUpperCase()
                                        )}
                                    </div>
                                    <h2 className="font-bold text-foreground">{member.name}</h2>
                                    <p className="text-sm text-primary font-medium">{member.role}</p>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </PageFrame>
    );
}
