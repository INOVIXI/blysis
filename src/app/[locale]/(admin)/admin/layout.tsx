
import { redirect } from "@/core/lib/i18n/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getSession } from "@/core/lib/auth";
import { panelReaderFor } from "@/core/lib/permissions";
import { mayEnterPanel } from "@/core/lib/admin-access";
import { AdminSidebar } from "@/core/components/admin/AdminSidebar";
import { AdminSpotlight } from "@/core/components/admin/AdminSpotlight";
import { AdminBreadcrumb } from "@/core/components/admin/AdminBreadcrumb";
import { ModuleUpdateBadge } from "@/core/components/admin/ModuleUpdateBadge";
import { UpdateNotificationBanner } from "@/core/components/admin/UpdateNotificationBanner";
import moduleSystem from "@/core/lib/modules";
import { prisma } from "@/core/lib/db";
import { getActiveTheme } from "@/core/lib/theme-state";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const session = await getSession();
    const locale = await getLocale();

    if (!session?.user) {
        redirect({ href: "/auth/login", locale });
    }

    // The building, not the room. A layout is not given the pathname, so
    // which screen a reader may open is settled in the proxy, which knows
    // both; this is the door, and it is checked here as well because a
    // request that reaches a server component has to have been let in by
    // something that saw a real session.
    const reader = await panelReaderFor(session.user.id);
    if (!mayEnterPanel(reader)) {
        redirect({ href: "/", locale });
    }

    // Initialize module states from DB so isEnabled() works correctly
    const dbModuleConfigs = await prisma.moduleConfig.findMany();
    await moduleSystem.initialize(
        dbModuleConfigs.map((mc) => ({
            id: mc.id,
            enabled: mc.enabled,
            config: mc.config as Record<string, unknown>,
        }))
    );

    const modules = moduleSystem.getEnabledModules();

    const { themeId } = await getActiveTheme();

    // What the menu and the palette may offer. A `Set` does not cross into a
    // client component, so the names travel as a list.
    const navReader = { isAdmin: reader.isAdmin, permissions: [...reader.permissions] };

    // The locale layout drops the admin namespace from what it sends to the
    // browser, since no public page renders it. This is where it comes back,
    // for the one tree that does. See core/lib/i18n/message-scopes.ts.
    const messages = await getMessages();

    return (
        <NextIntlClientProvider messages={messages}>
        <div className="min-h-screen bg-background" suppressHydrationWarning>
            <AdminSidebar
                userName={session.user.name || ""}
                userEmail={session.user.email || ""}
                modules={modules}
                activeThemeId={themeId}
                reader={navReader}
            />
            {/* Main content - cleared 56 (icon rail) + 224 (context sidebar) = 280px */}
            <main
                id="main-content"
                tabIndex={-1}
                className="lg:ml-[280px] min-h-screen bg-background flex flex-col"
            >
                <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-sm border-b border-border">
                    <div className="flex items-center justify-between gap-4 px-4 lg:px-6 h-14 pl-16 lg:pl-6">
                        <AdminBreadcrumb modules={modules} activeThemeId={themeId} />
                        <div className="flex items-center gap-3">
                            <div className="hidden md:block w-64">
                                <AdminSpotlight modules={modules} activeThemeId={themeId} reader={navReader} />
                            </div>
                            <ModuleUpdateBadge />
                        </div>
                    </div>
                </header>
                <div className="flex-1 p-4 lg:p-6">
                    <UpdateNotificationBanner />
                    {children}
                </div>
            </main>
        </div>
        </NextIntlClientProvider>
    );
}
