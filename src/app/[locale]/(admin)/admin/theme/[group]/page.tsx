import { notFound } from "next/navigation";
import { getSession } from "@/core/lib/auth";
import { canOpenAdminPage } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { getActiveTheme } from "@/core/lib/theme-state";
import { SchemaForm } from "@/core/components/admin/theme-settings/SchemaForm";

export default async function ThemeSettingsPage({
    params,
}: {
    params: Promise<{ group: string; locale: string }>;
}) {
    const session = await getSession();
    const { group, locale } = await params;
    // `/theme/appearance` is the declared path; a group nobody declared falls
    // through to `notFound` below, which is the same answer as a permission
    // nobody holds.
    if (!(await canOpenAdminPage(session?.user?.id, `/${locale}/admin/theme/${group}`))) notFound();

    const { themeId, manifest } = await getActiveTheme();
    const groupDef = manifest.settings?.[group];
    if (!groupDef) notFound();

    const rows = await prisma.themeSetting.findMany({ where: { themeId, groupKey: group } });
    const initialValues = Object.fromEntries(rows.map(r => [r.key, r.value]));

    return (
        <>
            {/* No `p-6` here: the admin layout already pads its own content,
                and a second one made every theme group start further in than
                every other screen. */}
            {/* The header is SchemaForm's, because the save button in it has
                to know whether a save is in flight, and that state is the
                form's. */}
            <SchemaForm
                themeId={themeId}
                group={group}
                fields={groupDef.fields}
                initialValues={initialValues}
                title={groupDef.label}
                description={manifest.name}
                backHref="/admin/theme/appearance"
                backLabel={manifest.name}
            />
        </>
    );
}
