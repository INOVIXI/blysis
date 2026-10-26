"use client";

import { Link } from "@/core/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/core/components/ui/card";
import { buttonClassName } from "@/core/components/ui/button";
import { Sparkles, Settings, Puzzle } from "lucide-react";
import { STAFF_ROLE_PRIORITY } from "@/core/lib/constants";

/**
 * What a homepage with nothing on it says. Staff are pointed at the
 * marketplace and the settings; a visitor is told the site is being set up.
 * It reads the session in the browser so the page around it stays one
 * render for everyone.
 */
export function HomeWelcome() {
    const commonT = useTranslations("common");
    const { data: session } = useSession();
    const isStaff = (session?.user?.rolePriority ?? 0) >= STAFF_ROLE_PRIORITY;

    return (
        <Card className="border-dashed">
            <CardContent className="py-14 px-6 text-center max-w-2xl mx-auto">
                <div className="w-14 h-14 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center mb-4">
                    <Sparkles className="w-7 h-7" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                    {commonT("welcomeTitle")}
                </h2>
                <p className="text-muted-foreground mb-6">
                    {commonT("welcomeDescription")}
                </p>
                {isStaff ? (
                    <div className="flex flex-wrap gap-3 justify-center">
                        <Link href="/admin/modules" className={buttonClassName("default", "default")}>
                            <Puzzle className="w-4 h-4" />
                            {commonT("welcomeBrowseModules")}
                        </Link>
                        <Link href="/admin/settings/general" className={buttonClassName("outline", "default")}>
                            <Settings className="w-4 h-4" />
                            {commonT("welcomeOpenSettings")}
                        </Link>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {commonT("welcomeVisitorHint")}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
