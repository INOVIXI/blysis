
import { notFound } from "next/navigation";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { redirect } from "@/core/lib/i18n/navigation";
import { ModuleAdminRegistry } from "@/core/generated/module-admin-page-registry";
import { matchModuleRoute } from "@/core/lib/route-matcher";
import { getSession } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
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

    const admin = await isAdmin(session.user.id);
    if (!admin) {
        redirect({ href: "/", locale });
    }

    const { params } = props;
    const { slug } = await params;

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
