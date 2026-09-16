import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { moduleSystem } from "@/core/lib/modules";
import { moduleLoader } from "@/core/lib/module-loader";

/**
 * The permission vocabulary, as a screen needs to draw it.
 *
 * The roles screen used to show raw names - `store.manage`, `forum.moderate` -
 * in a grid of module boxes, which asks an operator to know the codebase
 * before they can decide what a job involves. It shows sentences now, under
 * the heading of whatever offers them.
 *
 * Resolved here rather than in the browser because a module's label lives in
 * that module's own translations: the client would have to load ninety
 * namespaces to render one screen, and core would have to know which ones,
 * which is core knowing the modules by name.
 *
 * Core's own twelve come first, in four sections, because the panel is not a
 * module and its permissions are the ones an operator meets first.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The reader's language, from the request rather than from the account:
    // an operator who switches the site to English reads this screen in
    // English on the next load, like every other screen.
    const t = await getTranslations({ locale: await getLocale() });

    /** A key that is missing renders as itself, which is the tell to fix it. */
    function say(key: string): string {
        try {
            return t(key as never);
        } catch {
            return key;
        }
    }

    const entries = moduleSystem.permissionCatalogue();
    const sections = new Map<string, { id: string; title: string; permissions: { name: string; label: string }[] }>();

    const CORE_SECTION_TITLES: Record<string, string> = {
        panel: "permissions.sectionPanel",
        people: "permissions.sectionPeople",
        content: "permissions.sectionContent",
        system: "permissions.sectionSystem",
    };

    for (const entry of entries) {
        const isCore = entry.namespace === "core";
        const title = isCore
            ? say(CORE_SECTION_TITLES[entry.section] ?? entry.section)
            : moduleLoader.getModule(entry.section)?.manifest.name ?? entry.section;

        const section = sections.get(entry.section) ?? { id: entry.section, title, permissions: [] };
        section.permissions.push({ name: entry.name, label: say(entry.labelKey) });
        sections.set(entry.section, section);
    }

    return NextResponse.json({ sections: [...sections.values()] });
}
