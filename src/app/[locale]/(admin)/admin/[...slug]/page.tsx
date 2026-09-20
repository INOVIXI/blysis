
import { notFound } from "next/navigation";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { redirect } from "@/core/lib/i18n/navigation";
import { ModuleAdminRegistry } from "@/core/generated/module-admin-page-registry";
import { matchModuleRoute } from "@/core/lib/route-matcher";
import { getSession } from "@/core/lib/auth";
import { canOpenAdminPage } from "@/core/lib/permissions";
import { getLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

interface PageProps {
    params: Promise<{
        slug: string[];
        locale: string;
    }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DynamicAdminModulePage(props: PageProps) {
    // Every module page is rendered through here, so the bus is filled once
    // for all of them. `instrumentation.ts` bootstraps a different module
    // graph: without this a page asks a question no listener answers, and
    // gets its own input back with no error to show for it.
    await ensureHooks();
    const session = await getSession();
    const locale = await getLocale();
    if (!session?.user) {
        redirect({ href: "/auth/login", locale });
    }

    const { params } = props;
    const { slug } = await params;

    // A module screen is opened by the permission its manifest declares, the
    // same one the proxy checked on the way in. Asking `isAdmin` here refused
    // everybody an operator had granted that permission to.
    if (!(await canOpenAdminPage(session.user.id, `/${locale}/admin/${slug.join("/")}`))) {
        redirect({ href: "/admin", locale });
    }

    const pathSegments = ["admin", ...slug];
    const match = matchModuleRoute(pathSegments);

    if (!match) {
        notFound();
    }

    const Component = ModuleAdminRegistry[match.key];

    if (!Component) {
        console.error(`Module component not found in registry: ${match.key}`);
        notFound();
    }

    return <Component {...props} params={Promise.resolve({ ...await params, ...match.params })} />;
}
