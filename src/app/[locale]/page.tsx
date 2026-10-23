"use client";

import { Link } from "@/core/lib/i18n/navigation";
import { SiteShell } from "@/core/components/layout/SiteShell";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useAllModules } from "@/core/providers/module-provider";
import StandardSidebarLayout from "@/core/components/layout/SidebarLayout";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { ModuleWidgets, ModuleHomepageSections } from "@/core/generated/module-registry";
import { WidgetComponentRegistry, HomepageSectionRegistry } from "@/core/generated/module-components";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { Card, CardContent } from "@/core/components/ui/card";
import { buttonClassName } from "@/core/components/ui/button";
import { Sparkles, Settings, Puzzle } from "lucide-react";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { visibleWidgets } from "@/core/lib/homepage-widgets";
import { STAFF_ROLE_PRIORITY } from "@/core/lib/constants";

export default function HomePage() {
  const commonT = useTranslations('common');
  const { data: session } = useSession();
  const modules = useAllModules();
  const { settings } = useSiteSettings();
  const isStaff = (session?.user?.rolePriority ?? 0) >= STAFF_ROLE_PRIORITY;

  // Visibility and order are the admin's, from Settings > Widgets; see
  // homepage-widgets.ts for what each saved key means and what an unsaved
  // widget falls back to.
  const enabledWidgets = visibleWidgets(
    ModuleWidgets
      .filter(w => isEnabledIn(modules, w.module))
      .filter(w => WidgetComponentRegistry[w.id]),
    settings,
  );

  const enabledSections = ModuleHomepageSections
    .filter(s => isEnabledIn(modules, s.module))
    .filter(s => HomepageSectionRegistry[s.id]);

  return (
    <SiteShell>
      {/*
        The homepage is a stack of module sections, none of which is the
        page's own title, so it had no h1 at all: a screen reader landed on
        the page with nothing naming it, and the document outline started at
        h2. The name is not drawn since the design has no room for it, but
        it is announced and it is what a crawler reads first. site_name
        arrives from a client fetch, so the translated fallback is what
        renders until then rather than an empty heading.
      */}
      <h1 className="sr-only">{(settings.site_name as string) || commonT('home')}</h1>

      <div className="text-sm text-muted-foreground mb-4">
        <Link href="/" className="hover:text-primary transition-colors">{commonT('home')}</Link>
      </div>

      {(() => {
        const SidebarLayout = StandardSidebarLayout;

        const mainContent = enabledSections.length > 0 ? (
          <div className="space-y-8">
            {enabledSections.map((section) => {
              const SectionComponent = HomepageSectionRegistry[section.id];
              return (
                  <ModuleErrorBoundary key={section.id} componentId={section.id}>
                      <SectionComponent />
                  </ModuleErrorBoundary>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-14 px-6 text-center max-w-2xl mx-auto">
              <div className="w-14 h-14 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center mb-4">
                <Sparkles className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                {commonT('welcomeTitle')}
              </h2>
              <p className="text-muted-foreground mb-6">
                {commonT('welcomeDescription')}
              </p>
              {isStaff ? (
                <div className="flex flex-wrap gap-3 justify-center">
                  <Link href="/admin/modules" className={buttonClassName("default", "default")}>
                      <Puzzle className="w-4 h-4" />
                      {commonT('welcomeBrowseModules')}
                    </Link>
                  <Link href="/admin/settings/general" className={buttonClassName("outline", "default")}>
                      <Settings className="w-4 h-4" />
                      {commonT('welcomeOpenSettings')}
                    </Link>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {commonT('welcomeVisitorHint')}
                </p>
              )}
            </CardContent>
          </Card>
        );

        // No wrapper element: SidebarLayout supplies the spacing, and an
        // extra div would keep the column out of `:empty` even when every
        // widget renders null.
        const sidebarContent = enabledWidgets.length > 0 ? (
          <>
            {/*
              A section in the content column is a heading and then its
              cards; a widget is a card with its heading inside. Left to
              themselves the two columns start at the same y, which puts
              every widget card a heading's height above the cards it sits
              beside - the thing that reads as crooked on every screenshot
              of this page. The spacer is that heading's line and margin,
              and `a-column-starts-where-the-one-beside-it-does` holds the
              two numbers together.
            */}
            <div aria-hidden="true" className="hidden lg:block blysis-heading-spacer" />
            {enabledWidgets.map((w) => {
              const WidgetComponent = WidgetComponentRegistry[w.id];
              return (
                  <ModuleErrorBoundary key={w.id} componentId={w.id}>
                      <WidgetComponent />
                  </ModuleErrorBoundary>
              );
            })}
          </>
        ) : null;

        return sidebarContent ? (
          <SidebarLayout sidebar={sidebarContent}>{mainContent}</SidebarLayout>
        ) : (
          mainContent
        );
      })()}
    </SiteShell>
  );
}
