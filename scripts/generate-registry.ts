import fs from 'fs';
import path from 'path';
import { moduleManifestSchema, type ValidatedModuleManifest } from '../src/core/lib/module-manifest-schema';
import { findNavGroupConflicts, type ModuleNavGroupDeclaration } from '../src/core/lib/nav-group-conflicts';
import type { ModuleSetting } from '../src/core/lib/module-types';
import { exportedHttpMethods } from '../src/core/lib/http-methods';
import { CORE_ADMIN_SCREENS } from '../src/core/lib/admin-screens';
import { CORE_ADMIN_API, MEMBER_MUTATIONS } from '../src/core/lib/admin-api';

function toComponentName(basename: string): string {
    return basename
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

const MODULES_DIR = path.join(process.cwd(), 'src/modules');
const OUTPUT_FILE = path.join(process.cwd(), 'src/core/generated/module-registry.tsx');
const COMPONENTS_FILE = path.join(process.cwd(), 'src/core/generated/module-components.tsx');

interface LoadedManifest {
    moduleName: string;
    manifest: ValidatedModuleManifest;
}

function loadManifests(): LoadedManifest[] {
    if (!fs.existsSync(MODULES_DIR)) {
        return [];
    }

    const moduleDirs = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    const loaded: LoadedManifest[] = [];
    for (const moduleName of moduleDirs) {
        const manifestPath = path.join(MODULES_DIR, moduleName, 'module.json');
        if (!fs.existsSync(manifestPath)) continue;

        let raw: unknown;
        try {
            raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (err) {
            console.error(`[registry] ${moduleName}: invalid JSON in module.json -`, (err as Error).message);
            continue;
        }

        const parsed = moduleManifestSchema.safeParse(raw);
        if (!parsed.success) {
            const first = parsed.error.issues[0];
            const where = first.path.join('.');
            console.error(`[registry] ${moduleName}: manifest schema invalid${where ? ` at ${where}` : ''} - ${first.message}`);
            continue;
        }

        if (parsed.data.id !== moduleName) {
            console.error(`[registry] ${moduleName}: manifest id "${parsed.data.id}" does not match directory name - skipping`);
            continue;
        }

        loaded.push({ moduleName, manifest: parsed.data });
    }

    return loaded;
}

function buildImportPath(component: string, moduleName: string): string {
    const cleaned = component.replace(/\.tsx?$/, '');
    if (cleaned.startsWith('@core/')) {
        return `@/core/components/${cleaned.replace('@core/', '')}`;
    }
    return `@/modules/${moduleName}/${cleaned}`;
}

type ManifestItem = { module: string } & Record<string, string | number | boolean | string[] | undefined>;

function generateRegistry() {
    const loaded = loadManifests();

    // No `next/dynamic` here any more: every registry in this file holds a
    // component that is part of a page already rendering. The page registry
    // next door still uses it, because a module page is a route of its own.
    const imports = `/* eslint-disable */\nimport type { ComponentType } from 'react';\n\n`;
    /*
     * A module page is imported for real, not through `next/dynamic`.
     *
     * `dynamic(..., { loading: () => <PageLoader /> })` split nothing: both
     * mount points are server components, and Next collects a route's client
     * references by walking its graph, so all of them were in the entry chunk
     * with `async: false` either way. What it did do was put a Suspense
     * boundary around every module page - the server streamed a full screen
     * spinner into the first pass and the client, holding the already-loaded
     * module, rendered the page there instead. Every module page on the site
     * threw "Hydration failed because the server rendered HTML didn't match
     * the client" and React threw its tree away and rebuilt it. Core's own
     * pages were clean, which is what pointed here.
     */
    const publicImportLines: string[] = [];
    const adminImportLines: string[] = [];
    let pageSymbol = 0;

    // Two registries, not one, and in two files rather than two exports.
    //
    // Both surfaces used to live in one map that both catch-alls imported, and
    // Next collects a route's client references by walking its module graph:
    // 110 admin page components were therefore first-loaded by every public
    // module page, and 38 public ones by every admin screen. Measured on a
    // production build, that one chunk was 520,464 raw bytes on a page where a
    // visitor reads a blog article, and it held the store's admin product
    // editor and the SEO admin screens.
    //
    // Two exports in one file would not have helped: the file is evaluated as
    // a whole, so the `dynamic()` calls are in the graph whichever export is
    // read.
    let mapping = `export const ModuleRegistry: Record<string, ComponentType<any>> = {\n`;
    let adminMapping = `export const ModuleAdminRegistry: Record<string, ComponentType<any>> = {\n`;
    let apiMapping = `export const ModuleApiRegistry: Record<string, () => Promise<Record<string, unknown>>> = {\n`;
    const routes: { path: string; key: string; module: string; isAdmin?: boolean; noindex?: boolean; titleFromPath?: boolean; titleKey?: string; descriptionKey?: string; ogType?: "website" | "article" | "profile"; userProfile?: boolean }[] = [];
    const apiRoutes: { path: string; key: string; module: string; handler: string; method?: string; methods?: string[]; providerCallback?: boolean; rateLimit?: { maxRequests: number; windowMs: number } }[] = [];
    const routeResolvers: { key: string; module: string; handler: string }[] = [];

    for (const { moduleName, manifest } of loaded) {
        for (const route of manifest.routes ?? []) {
            const componentKey = `${moduleName}:${route.component}`;
            const importPath = `@/modules/${moduleName}/${route.component.replace(/\.tsx?$/, '')}`;
            const symbol = `Page${pageSymbol++}`;
            publicImportLines.push(`import ${symbol} from '${importPath}';`);
            mapping += `  '${componentKey}': ${symbol},\n`;
            routes.push({ path: route.path, key: componentKey, module: moduleName, ...(route.noindex ? { noindex: true } : {}), ...(route.titleFromPath ? { titleFromPath: true } : {}), ...(route.titleKey ? { titleKey: route.titleKey } : {}), ...(route.descriptionKey ? { descriptionKey: route.descriptionKey } : {}), ...(route.ogType ? { ogType: route.ogType } : {}), ...(route.userProfile ? { userProfile: true } : {}) });
            if (route.resolver) routeResolvers.push({ key: componentKey, module: moduleName, handler: route.resolver });
        }

        for (const route of manifest.adminRoutes ?? []) {
            const componentKey = `${moduleName}:${route.component}`;
            const importPath = `@/modules/${moduleName}/${route.component.replace(/\.tsx?$/, '')}`;
            const fullPath = `/admin${route.path.startsWith('/') ? route.path : '/' + route.path}`;
            const symbol = `Page${pageSymbol++}`;
            adminImportLines.push(`import ${symbol} from '${importPath}';`);
            adminMapping += `  '${componentKey}': ${symbol},\n`;
            routes.push({ path: fullPath, key: componentKey, module: moduleName, isAdmin: true });
        }

        for (const api of manifest.api ?? []) {
            const apiKey = `${moduleName}:api:${api.path}`;
            const handlerImportPath = `@/modules/${moduleName}/${api.handler.replace(/\.ts?$/, '')}`;
            const handlerFile = path.join(MODULES_DIR, moduleName, api.handler.replace(/^\.?\//, ''));
            const handlerMethods = fs.existsSync(handlerFile)
                ? exportedHttpMethods(fs.readFileSync(handlerFile, 'utf8'))
                : [];
            apiMapping += `  '${apiKey}': () => import('${handlerImportPath}'),\n`;
            apiRoutes.push({
                path: api.path,
                key: apiKey,
                module: moduleName,
                // The handler file, not the URL. A manifest may declare one
                // handler at more than one path, and the rate-limit bucket has
                // to follow the handler or each alias gets its own budget.
                handler: api.handler.replace(/^\.?\//, ''),
                method: api.method || 'ALL',
                // The verbs the handler file exports, so the dispatcher can
                // answer OPTIONS and put an Allow on a 405 without importing
                // it. A manifest `method` narrows this; it cannot widen it.
                ...(handlerMethods.length > 0 ? { methods: handlerMethods } : {}),
                // Carried into the route table so the dispatcher can pick the
                // right rate-limit bucket without reading the manifest.
                ...(api.providerCallback ? { providerCallback: true } : {}),
                ...(api.rateLimit ? { rateLimit: api.rateLimit } : {}),
            });
        }
    }

    mapping += `};\n`;
    adminMapping += `};\n`;
    apiMapping += `};\n\n`;
    // Route tables are plain data - no imports, safe anywhere.
    let routeData = `export const ModuleRoutes: { path: string; key: string; module: string; isAdmin?: boolean; noindex?: boolean; titleFromPath?: boolean; titleKey?: string; descriptionKey?: string; ogType?: "website" | "article" | "profile"; userProfile?: boolean }[] = ${JSON.stringify(routes, null, 2)};\n\n`;
    routeData += `export const ModuleApiRoutes: { path: string; key: string; module: string; handler: string; method?: string; methods?: string[]; providerCallback?: boolean; rateLimit?: { maxRequests: number; windowMs: number } }[] = ${JSON.stringify(apiRoutes, null, 2)};`;

    // Aggregate typed collections across all modules
    const allWidgets: ({ id: string; component: string; defaultOrder: number; defaultVisible: boolean; module: string })[] = [];
    const allNavLinks: ({ label: string; labelKey?: string; href: string; icon?: string; position?: number; module: string })[] = [];
    // Endpoints a module says a public demo must refuse. Core knows the shape
    // of the danger and cannot know which of a module's paths has it.
    const allDemoUnsafe: ({ path: string; module: string })[] = [];
    const allFooterLinks: ManifestItem[] = [];
    const allChallengePoints: ManifestItem[] = [];
    const allDashboardCards: ManifestItem[] = [];
    const allDashboardSections: ManifestItem[] = [];
    const allHomepageSections: ({ id: string; type: 'content' | 'widget'; component: string; order: number; module: string })[] = [];
    const allLayoutComponents: ({ id: string; component: string; include?: string[]; exclude?: string[]; module: string })[] = [];
    const allNavbarComponents: ({ id: string; component: string; order: number; module: string })[] = [];
    const allFooterComponents: ({ id: string; component: string; section?: string; order?: number; module: string })[] = [];
    const allSettingsCards: ManifestItem[] = [];
    const allOauthButtons: ManifestItem[] = [];
    const allNavGroups: ModuleNavGroupDeclaration[] = [];
    const allAuthProviders: ({ id: string; envIdVar?: string; envSecretVar?: string; factory?: string; standardCallback?: boolean; envVars?: string[]; module: string })[] = [];
    const allWebhookChannels: ({ id: string; label: string; layout: string; hosts?: string[]; urlPlaceholder?: string; module: string })[] = [];
    const allProfileTabs: ({ id: string; label: string; component: string; order: number; module: string })[] = [];
    const allStorageProviders: ({ id: string; name: string; handler: string; module: string })[] = [];
    const allContextProviders: ({ id: string; component: string; order?: number; module: string })[] = [];
    const allHookListeners: ({ hook: string; type: 'action' | 'filter'; handler: string; priority?: number; module: string })[] = [];
    const allSlotContents: ({ id: string; slot: string; component: string; order?: number; module: string })[] = [];
    const allCronJobs: ({ id: string; schedule: string; handler: string; module: string })[] = [];
    const allSearchProviders: ({ id: string; label: string; handler: string; icon?: string; indexes?: { table: string; columns: string[] }[]; module: string })[] = [];
    const allActivityTitles: ({ type: string; nameKey: string; prefix?: string; key?: string; module: string })[] = [];
    const allPermissionResources: string[] = [];
    const allWebhookReceivers: ({ provider: string; handler: string; signatureHeader?: string; secretEnv?: string; verifiesInHandler?: boolean; timestampHeader?: string; module: string })[] = [];
    const allNotificationTypes: ({ eventType: string; label: string; description?: string; channels?: string[]; module: string })[] = [];
    const allSeoRoutes: ({ module: string; handler: string })[] = [];
    const allUserDataTables: ({ model: string; key: string; column: string; erasure?: "purge" | "retain"; module: string })[] = [];
    const allModerationProviders: ({ id: string; label: string; labelKey?: string; settingKey?: string; settingLabelKey?: string; settingDescKey?: string; handler: string; module: string })[] = [];
    const allSettings: Record<string, ModuleSetting[]> = {};
    const allSecretSettings = new Set<string>();
    const allEmailApiKeySettings = new Set<string>();
    const allEmailApiKeyEnvVars = new Set<string>();
    const allEmailProviders: { id: string; name: string; handler: string; module: string }[] = [];


    for (const { moduleName, manifest } of loaded) {
        manifest.widgets?.forEach((w) => allWidgets.push({ ...w, module: moduleName }));
        manifest.navLinks?.forEach((l) => allNavLinks.push({ ...l, module: moduleName }));
        manifest.demoUnsafe?.forEach((path: string) => allDemoUnsafe.push({ path, module: moduleName }));
        manifest.footerLinks?.forEach((l) => allFooterLinks.push({ ...l, module: moduleName }));
        manifest.challengePoints?.forEach((c) => allChallengePoints.push({ ...c, module: moduleName }));
        manifest.dashboardCards?.forEach((c) => allDashboardCards.push({ ...c, module: moduleName }));
        manifest.dashboardSections?.forEach((sec) => allDashboardSections.push({ ...sec, module: moduleName }));
        manifest.layoutComponents?.forEach((lc) => allLayoutComponents.push({ ...lc, module: moduleName }));
        manifest.profileTabs?.forEach((pt) => allProfileTabs.push({ ...pt, module: moduleName }));
        manifest.oauthButtons?.forEach((btn) => allOauthButtons.push({ ...btn, module: moduleName }));
        manifest.navGroups?.forEach((ng) => allNavGroups.push({ ...ng, module: moduleName }));
        manifest.authProviders?.forEach((ap) => allAuthProviders.push({ ...ap, module: moduleName }));
        manifest.webhookChannels?.forEach((wc) => allWebhookChannels.push({ ...wc, module: moduleName }));
        if (manifest.settings?.length) allSettings[manifest.id] = manifest.settings;
        manifest.secretSettings?.forEach((key: string) => allSecretSettings.add(key));
        if (manifest.emailProvider) allEmailApiKeySettings.add(manifest.emailProvider.apiKeySetting);
        if (manifest.emailProvider?.envVar) allEmailApiKeyEnvVars.add(manifest.emailProvider.envVar);
        if (manifest.emailProvider?.handler) {
            allEmailProviders.push({
                id: moduleName,
                name: manifest.emailProvider.name || manifest.name || moduleName,
                handler: manifest.emailProvider.handler,
                module: moduleName,
            });
        }
        manifest.settingsCards?.forEach((sc) => allSettingsCards.push({ ...sc, module: moduleName }));
        manifest.navbarComponents?.forEach((nc) => allNavbarComponents.push({ ...nc, module: moduleName }));
        manifest.footerComponents?.forEach((fc) => allFooterComponents.push({ ...fc, module: moduleName }));
        manifest.storageProviders?.forEach((sp) => allStorageProviders.push({ ...sp, module: moduleName }));
        manifest.contextProviders?.forEach((cp) => allContextProviders.push({ ...cp, module: moduleName }));
        manifest.hookListeners?.forEach((hl) => allHookListeners.push({ ...hl, module: moduleName }));
        manifest.slotContents?.forEach((sc) => allSlotContents.push({ ...sc, module: moduleName }));
        manifest.cronJobs?.forEach((cj) => allCronJobs.push({ ...cj, module: moduleName }));
        manifest.searchProviders?.forEach((sp) => allSearchProviders.push({ ...sp, module: moduleName }));
        manifest.activityTitles?.forEach((at) => allActivityTitles.push({ ...at, module: moduleName }));
        manifest.permissionResources?.forEach((r) => allPermissionResources.push(r));
        manifest.webhookReceivers?.forEach((wr) => allWebhookReceivers.push({ ...wr, module: moduleName }));
        manifest.notificationTypes?.forEach((nt) => allNotificationTypes.push({ ...nt, module: moduleName }));
        manifest.homepageSections?.forEach((section) => allHomepageSections.push({ ...section, module: moduleName }));
        if (manifest.seoRoutes?.handler) {
            allSeoRoutes.push({ module: moduleName, handler: manifest.seoRoutes.handler });
        }
        manifest.userDataExport?.forEach((u) => allUserDataTables.push({ ...u, module: moduleName }));
        manifest.moderationProviders?.forEach((mp) => allModerationProviders.push({ ...mp, module: moduleName }));

        // Canonical `slots` field. `slotContents` above is the same contribution
        // under its original name, so both feed the one registry `<Slot>` reads.
        // There is deliberately no alias from `navbarComponents`,
        // `layoutComponents`, `homepageSections` or `profileTabs` into a slot:
        // each of those already has its own render path, and contributing them
        // twice is what made the popups module draw two stacked popups.
        (manifest as unknown as { slots?: { name: string; component: string; order?: number; id?: string }[] }).slots?.forEach((s, i) => {
            allSlotContents.push({
                id: s.id ?? `${moduleName}-${s.name}-${i}`,
                slot: s.name,
                component: s.component,
                order: s.order,
                module: moduleName,
            });
        });
    }

    allNavLinks.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    allWidgets.sort((a, b) => a.defaultOrder - b.defaultOrder);
    allHomepageSections.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    allNavbarComponents.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    allFooterComponents.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    allContextProviders.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    allProfileTabs.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    /**
     * Components a module contributes to a page somebody is already looking at:
     * a widget, a homepage section, a profile tab, something in the navbar or
     * the footer, or content for another module's slot.
     *
     * Imported, not lazily loaded. These used to be `next/dynamic` with
     * `loading: () => null`, and the parent that renders them is a client
     * component, so `dynamic` could not render them on the server either - the
     * homepage's server HTML contained none of the widget markup at all. The
     * page painted a shell and about a second later the chunks landed and put
     * roughly 1200px of cards into the sidebar at once, which moved everything
     * below them and pushed the footer out of the viewport. Cumulative layout
     * shift measured 0.29 against a 0.1 budget.
     *
     * Lazy loading was buying nothing: an entry is only emitted for a module
     * that is installed, so the import path always resolves at build time and
     * there is no runtime question for it to answer. What it cost was a second
     * round trip and a component that rendered nothing until it arrived.
     *
     * A module *page* is still split, because that is a route of its own that
     * a visitor may never open. These are pieces of a page already rendering.
     */
    let staticImportLines = '';
    let staticImportCount = 0;
    /** The component maps, which go to their own file: see below. */
    let componentBody = '';

    function emitStaticRegistry(
        label: string,
        exportName: string,
        items: Array<{ id: string; component: string; module: string }>,
    ): void {
        let out = `// ${label}\nexport const ${exportName}: Record<string, ComponentType<any>> = {\n`;
        for (const item of items) {
            const importPath = buildImportPath(item.component, item.module);
            const baseName = toComponentName(path.basename(importPath));
            // A namespace import, because which name the component is exported
            // under varies: the file's own name, the registry id, or default.
            const alias = `mod${staticImportCount++}`;
            staticImportLines += `import * as ${alias} from '${importPath}';\n`;
            out += `  '${item.id}': pickComponent(${alias}, '${baseName}', '${item.id}'),\n`;
        }
        out += '};\n\n';
        componentBody += out;
    }

    emitStaticRegistry('Widget component registry', 'WidgetComponentRegistry', allWidgets);
    emitStaticRegistry('Homepage section component registry', 'HomepageSectionRegistry', allHomepageSections);
    const homepageSectionImports = `export const ModuleHomepageSections: { id: string; type: string; component: string; order: number; module: string }[] = ${JSON.stringify(allHomepageSections, null, 2)};\n\n`;

    let widgetRegistry = `export const ModuleWidgets: { id: string; label?: string; labelKey?: string; component: string; module: string; defaultOrder: number; defaultVisible: boolean }[] = ${JSON.stringify(allWidgets, null, 2)};\n\n`;
    widgetRegistry += `export const ModuleNavLinks: { label: string; labelKey?: string; href: string; icon?: string; position?: number; module: string }[] = ${JSON.stringify(allNavLinks, null, 2)};\n\n`;
    widgetRegistry += `export const ModuleDemoUnsafe: { path: string; module: string }[] = ${JSON.stringify(allDemoUnsafe.sort((a, b) => a.path.localeCompare(b.path)), null, 2)};\n\n`;
    widgetRegistry += `export const ModuleFooterLinks: { label: string; labelKey?: string; href: string; section?: string; module: string }[] = ${JSON.stringify(allFooterLinks, null, 2)};\n\n`;
    // The forms a challenge module may be switched on for. Core's own three
    // are added beside these in `challenge-points.ts`.
    widgetRegistry += `export const ModuleChallengePoints: { id: string; labelKey: string; module: string }[] = ${JSON.stringify(allChallengePoints, null, 2)};\n\n`;
    widgetRegistry += `export const ModuleDashboardCards: { id: string; label: string; labelKey?: string; icon: string; href: string; color: string; statKey: string; module: string }[] = ${JSON.stringify(allDashboardCards, null, 2)};\n\n`;
    widgetRegistry += `export const ModuleDashboardSections: { id: string; label: string; labelKey?: string; module: string }[] = ${JSON.stringify(allDashboardSections, null, 2)};\n\n`;
    widgetRegistry += `// Activity-feed title localization entries contributed by modules.\n`;
    widgetRegistry += `export const ModuleActivityTitles: { type: string; nameKey: string; prefix?: string; key?: string; module: string }[] = ${JSON.stringify(allActivityTitles, null, 2)};\n\n`;
    widgetRegistry += `// RBAC resource strings modules own - surfaced in the admin permission matrix (flattened + deduped).\n`;
    widgetRegistry += `export const ModulePermissionResources: string[] = ${JSON.stringify([...new Set(allPermissionResources)], null, 2)};\n\n`;

    emitStaticRegistry('Profile tab component registry', 'ProfileTabRegistry', allProfileTabs);
    const profileTabImports = `export const ModuleProfileTabs: { id: string; label: string; labelKey?: string; component: string; order: number; module: string }[] = ${JSON.stringify(allProfileTabs, null, 2)};\n\n`;

    widgetRegistry += profileTabImports;
    widgetRegistry += `export const ModuleOauthButtons: { id: string; provider: string; label: string; color: string; svgIcon: string; href?: string; module: string }[] = ${JSON.stringify(allOauthButtons, null, 2)};\n\n`;
    widgetRegistry += `// Admin nav groups declared by modules. A group with no items is never rendered.\n`;
    widgetRegistry += `export const ModuleNavGroups: { id: string; label: string; icon?: string; order?: number; module: string }[] = ${JSON.stringify(allNavGroups, null, 2)};\n\n`;
    widgetRegistry += `export const ModuleSettingsCards: { title: string; description: string; href: string; icon: string; color: string; module: string }[] = ${JSON.stringify(allSettingsCards, null, 2)};\n\n`;
    widgetRegistry += `// User-data registry: tables modules contribute to GDPR personal-data exports,\n// each saying whether erasure purges it or keeps it. See user-deletion.ts.\n`;
    widgetRegistry += `export const ModuleUserDataTables: { model: string; key: string; column: string; erasure?: "purge" | "retain"; module: string }[] = ${JSON.stringify(allUserDataTables, null, 2)};\n`;

    emitStaticRegistry('Layout component registry (rendered on every page)', 'LayoutComponentRegistry', allLayoutComponents);
    const layoutImports = `export const ModuleLayoutComponents: { id: string; component: string; module: string; include?: string[]; exclude?: string[] }[] = ${JSON.stringify(allLayoutComponents, null, 2)};\n\n`;

    emitStaticRegistry('Navbar component registry (rendered in navbar right side)', 'NavbarComponentRegistry', allNavbarComponents);
    const navbarImports = `export const ModuleNavbarComponents: { id: string; component: string; order: number; module: string }[] = ${JSON.stringify(allNavbarComponents, null, 2)};\n\n`;

    emitStaticRegistry('Footer component registry (rendered in site footer)', 'FooterComponentRegistry', allFooterComponents);
    const footerImports = `export const ModuleFooterComponents: { id: string; component: string; section?: string; order?: number; module: string }[] = ${JSON.stringify(allFooterComponents, null, 2)};\n\n`;

    // Context providers are the one registry that must be imported statically.
    // `next/dynamic` wraps its component in a Suspense boundary, and these
    // providers WRAP the page, so the whole document ends up inside that
    // boundary: React flushes the shell before the page renders, the response
    // is committed as 200, and a later `notFound()` or a thrown error can no
    // longer set a status. Every 404 on the site was a soft 404 because of it.
    let contextProviderImports = '';
    let contextRegistry = '// Context provider registry - wraps children, used for React contexts\n';
    contextRegistry += '// Statically imported on purpose: see scripts/generate-registry.ts.\n';
    contextRegistry += `export const ContextProviderRegistry: Record<string, ComponentType<any>> = {\n`;
    allContextProviders.forEach((cp, index) => {
        const importPath = buildImportPath(cp.component, cp.module);
        const baseName = toComponentName(path.basename(importPath));
        const ns = `ContextProviderModule${index}`;
        contextProviderImports += `import * as ${ns} from '${importPath}';\n`;
        contextRegistry += `  '${cp.id}': pickContextProvider(${ns} as unknown as Record<string, unknown>, '${cp.id}', '${baseName}'),\n`;
    });
    if (contextProviderImports) contextProviderImports += '\n';
    contextRegistry += '};\n\n';
    const contextImports = `export const ModuleContextProviders: { id: string; component: string; order?: number; module: string }[] = ${JSON.stringify(allContextProviders, null, 2)};\n\n`;

    const contextProviderHelper = allContextProviders.length > 0
        ? `// Resolves the provider a module exported, whatever it named it.\n` +
          `function pickContextProvider(mod: Record<string, unknown>, id: string, baseName: string): ComponentType<any> {\n` +
          `    return (mod[id] ?? mod[baseName] ?? mod.default ?? mod) as ComponentType<any>;\n` +
          `}\n\n`
        : '';
    componentBody += contextProviderHelper + contextRegistry;

    emitStaticRegistry("Slot content registry - modules injecting into other modules' named slots", 'SlotContentRegistry', allSlotContents);
    const slotImports = `export const ModuleSlotContents: { id: string; slot: string; component: string; order?: number; module: string }[] = ${JSON.stringify(allSlotContents, null, 2)};\n\n`;

    // The namespace imports the registries above reference, and the one
    // helper that reads a component out of one. Which name a module exports
    // its component under varies - the file's own name, the registry id, or
    // default - and the lazy version resolved the same three in the same
    // order.
    const pickHelper =
        `function pickComponent(ns: Record<string, unknown>, ...names: string[]): ComponentType<any> {\n` +
        `    for (const name of names) {\n` +
        `        const found = ns[name];\n` +
        `        if (found) return found as ComponentType<any>;\n` +
        `    }\n` +
        `    return (ns.default ?? ns) as ComponentType<any>;\n` +
        `}\n\n`;

    /*
     * Two files, because they cost different things to import.
     *
     * The component maps now hold real imports rather than lazy ones, so
     * importing them pulls every widget, tab and slot a module contributes,
     * and with them next-intl, the icon set and whatever else those
     * components reach for. The data arrays beside them are plain JSON that
     * server code and tests read constantly - route tables, the GDPR table
     * list, the permission resources. Leaving the two in one file made every
     * one of those readers pay for the component tree; six test suites went
     * from reading an array to failing on a client-only import.
     */
    const componentsContent =
        `/* eslint-disable */\nimport type { ComponentType } from 'react';\n\n` +
        staticImportLines + contextProviderImports + '\n' + pickHelper + componentBody;

    const registryContent =
        imports + routeData + '\n\n' +
        homepageSectionImports + layoutImports + navbarImports +
        footerImports + contextImports + slotImports + widgetRegistry;

    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, registryContent);
    fs.writeFileSync(COMPONENTS_FILE, componentsContent);
    console.log(`Generated module registry at ${OUTPUT_FILE}`);
    console.log(`Generated module component registry at ${COMPONENTS_FILE}`);

    // The API handler map lives in its own file, and deliberately so.
    //
    // module-registry.tsx is reachable from client components - the locale
    // layout renders ModuleContextProviders out of it. Every entry below is
    // a module API route: server-only code that reaches the database, the
    // filesystem and the logger. Emitting them into the same module put
    // those route files in the browser graph, where `fs/promises`,
    // `async_hooks` and `next/headers` do not exist, and `next build` failed
    // on any installation that had modules. A lazy `() => import(...)` is
    // not enough - the bundler still has to trace it.
    //
    // Only src/app/api/v1/[...path]/route.ts consumes this.
    // Module page components go in their own file for the same reason as the
    // API handlers below: they are server components that read the database,
    // and module-registry.tsx is imported by client components.
    //
    // Only the two catch-all page routes consume this.
    const PAGE_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-page-registry.tsx');
    const pageHeader = (lines: string[]) =>
        `/* eslint-disable */\nimport type { ComponentType } from 'react';\n${lines.join('\n')}\n\n`;
    fs.writeFileSync(PAGE_FILE, pageHeader(publicImportLines) + mapping);
    console.log(`Generated module page registry at ${PAGE_FILE}`);

    const ADMIN_PAGE_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-admin-page-registry.tsx');
    fs.writeFileSync(ADMIN_PAGE_FILE, pageHeader(adminImportLines) + adminMapping);
    console.log(`Generated module admin page registry at ${ADMIN_PAGE_FILE}`);

    const API_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-api-registry.ts');
    const apiContent =
        '// Auto-generated by scripts/generate-registry.ts \u2014 do not edit.\n' +
        '// Server-only: never import this from a client component.\n' +
        '/* eslint-disable */\n\n' +
        apiMapping;
    fs.writeFileSync(API_FILE, apiContent);
    console.log(`Generated module API registry at ${API_FILE}`);

    for (const conflict of findNavGroupConflicts(allNavGroups)) {
        console.warn(
            `[registry] nav group "${conflict.id}": using ${conflict.field} ` +
            `"${conflict.winningValue}" from "${conflict.winner}"; ` +
            `"${conflict.loser}" declares "${conflict.losingValue}".`,
        );
    }

    const DATA_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-data.ts');
    let dataContent = '// Auto-generated server-safe module data - no dynamic imports\n';
    dataContent += `import type { ModuleSetting } from "@/core/lib/module-types";\n\n`;
    dataContent += `export const ModuleApiRoutes: { path: string; key: string; module: string; handler: string; method?: string; methods?: string[]; providerCallback?: boolean; rateLimit?: { maxRequests: number; windowMs: number } }[] = ${JSON.stringify(apiRoutes, null, 2)};\n\n`;
    dataContent += `export const ModuleRoutesList: { path: string; key: string; module: string; isAdmin?: boolean; noindex?: boolean; titleFromPath?: boolean; titleKey?: string; descriptionKey?: string; ogType?: "website" | "article" | "profile"; userProfile?: boolean }[] = ${JSON.stringify(routes, null, 2)};\n\n`;
    dataContent += `// Outbound webhook channels contributed by modules. Core owns the alert\n`;
    dataContent += `// content and the wire layouts; a channel only names its hosts and layout.\n`;
    dataContent += `// Admin-editable settings declared by each module, keyed by module id.\n`;
    dataContent += `// Core renders, validates and clamps these without knowing what any key means.\n`;
    dataContent += `export const ModuleSettings: Record<string, ModuleSetting[]> = ${JSON.stringify(allSettings, null, 2)};\n\n`;
    dataContent += `// Setting keys whose value is a credential, declared by the modules that\n`;
    dataContent += `// own them. Core encrypts these on write and never returns one to a\n`;
    dataContent += `// browser; a "key.field" entry addresses one field of a stored object.\n`;
    dataContent += `export const ModuleSecretSettings: string[] = ${JSON.stringify([...allSecretSettings].sort(), null, 2)};\n\n`;
    dataContent += `// Settings keys a mail provider module writes its API key to. Core owns the\n`;
    dataContent += `// mailer and asks which key holds the credential rather than knowing a name.\n`;
    dataContent += `export const ModuleEmailApiKeySettings: string[] = ${JSON.stringify([...allEmailApiKeySettings].sort(), null, 2)};\n\n`;
    dataContent += `export const ModuleEmailApiKeyEnvVars: string[] = ${JSON.stringify([...allEmailApiKeyEnvVars].sort(), null, 2)};\n\n`;
    // The transports installed, as names an operator reads. Plain data, kept
    // apart from the registry beside it: that one holds dynamic imports of
    // server-only handlers and has no business in a browser bundle.
    dataContent += `export const ModuleEmailProviders: { id: string; name: string }[] = ${JSON.stringify(allEmailProviders.map((e) => ({ id: e.id, name: e.name })), null, 2)};\n\n`;
    dataContent += `export const ModuleWebhookChannels: { id: string; label: string; layout: "json" | "embed" | "attachment"; hosts?: string[]; urlPlaceholder?: string; module: string }[] = ${JSON.stringify(allWebhookChannels, null, 2)};\n`;
    fs.writeFileSync(DATA_FILE, dataContent);

    // ── Auth.js providers ─────────────────────────────────────────────────
    // Emitted as static imports rather than a runtime `require(\`.../${id}\`)`:
    // a dynamic specifier makes the bundler treat next-auth/providers as a
    // context module and pull in every provider it ships (including ones with
    // optional native dependencies), which fails to build.
    //
    // The id is interpolated into an import specifier here, so it is re-checked
    // even though the manifest schema already enforces the same slug rule.
    const PROVIDER_ID = /^[a-z0-9][a-z0-9-]*$/;
    // A module-supplied provider's factory path is interpolated into an import
    // specifier too, so it gets the same second look: in-tree, relative, no
    // traversal. The manifest schema already enforces this; a manifest that
    // reached codegen without passing validation must not be the one chance to
    // catch it.
    const FACTORY_PATH = /^[A-Za-z0-9_][A-Za-z0-9_\-./]*$/;
    const authProviderImports: string[] = [];
    const authProviderEntries: string[] = [];
    const seenProviderIds = new Set<string>();
    const safeAuthProviders = allAuthProviders.filter((p) => {
        if (!PROVIDER_ID.test(p.id)) {
            console.warn(
                `[registry] module "${p.module}" declared an unsafe auth provider id "${p.id}" - skipped.`,
            );
            return false;
        }
        if (p.factory !== undefined) {
            const factory = String(p.factory);
            if (!FACTORY_PATH.test(factory) || factory.split('/').includes('..')) {
                console.warn(
                    `[registry] module "${p.module}" declared an unsafe auth provider factory ` +
                        `"${factory}" - skipped.`,
                );
                return false;
            }
        }
        return true;
    });
    const moduleProviderEntries: string[] = [];
    for (const provider of safeAuthProviders) {
        if (seenProviderIds.has(provider.id)) continue;
        seenProviderIds.add(provider.id);
        const local = `AuthProvider_${provider.id.replace(/-/g, '_')}`;
        if (provider.factory) {
            // Module-supplied provider: the file lives in the module's own tree
            // and is imported through the same `@/modules/<name>/...` alias
            // every other module ref uses.
            const factoryPath = String(provider.factory).replace(/\.tsx?$/, '');
            authProviderImports.push(`import ${local} from "@/modules/${provider.module}/${factoryPath}";`);
            moduleProviderEntries.push(`    ${JSON.stringify(provider.id)}: ${local},`);
        } else {
            authProviderImports.push(`import ${local} from "next-auth/providers/${provider.id}";`);
            authProviderEntries.push(`    ${JSON.stringify(provider.id)}: ${local},`);
        }
    }

    const AUTH_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-auth-providers.ts');
    // The same declarations with none of the imports.
    //
    // `module-auth-providers.ts` has to import every provider it can build, so
    // anything reading it drags next-auth's whole provider surface and each
    // module's own provider file in with it - which is a cycle for a route that
    // only wants to know which ids exist, and answered 500 with "Cannot access
    // 'ModuleAuthProviders' before initialization". The data is data; this file
    // is the half of it that imports nothing.
    const AUTH_DECLARATIONS_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-auth-declarations.ts');
    let authContent = '// Auto-generated Auth.js provider registry - server only\n';
    authContent += '// Core names no OAuth provider. Every entry here comes from an installed\n';
    authContent += "// module's `authProviders` manifest declaration, and only activates once\n";
    authContent += '// the env vars it names are set.\n';
    if (authProviderImports.length > 0) authContent += `${authProviderImports.join('\n')}\n`;
    authContent += '\n';
    authContent += `export const ModuleAuthProviders: { id: string; envIdVar?: string; envSecretVar?: string; factory?: string; standardCallback?: boolean; envVars?: string[]; module: string }[] = ${JSON.stringify(safeAuthProviders, null, 2)};\n\n`;
    const declarationsContent =
        '// AUTO-GENERATED. Do not edit.\n' +
        '//\n' +
        '// What each installed module declared about its auth provider, with no\n' +
        '// imports: a reader that only needs the ids and the env vars they want\n' +
        '// must not pull every provider next-auth ships in behind them.\n\n' +
        `export const ModuleAuthDeclarations: { id: string; envIdVar?: string; envSecretVar?: string; factory?: string; standardCallback?: boolean; envVars?: string[]; module: string }[] = ${JSON.stringify(safeAuthProviders, null, 2)};\n`;
    fs.writeFileSync(AUTH_DECLARATIONS_FILE, declarationsContent);

    authContent += '// Providers Auth.js ships. Each one takes a client id and secret and\n';
    authContent += '// nothing else.\n';
    authContent += 'export const ModuleAuthProviderFactories: Record<string, (config: {\n';
    authContent += '    clientId: string;\n';
    authContent += '    clientSecret: string;\n';
    authContent += '    allowDangerousEmailAccountLinking: boolean;\n';
    authContent += '}) => unknown> = {\n';
    authContent += authProviderEntries.length > 0 ? `${authProviderEntries.join('\n')}\n` : '';
    authContent += '};\n\n';
    authContent += '// Providers a module built itself. Each one receives the env vars its\n';
    authContent += '// manifest declared, already checked to be present and non-empty.\n';
    authContent += 'export const ModuleOwnAuthProviderFactories: Record<string, (config: {\n';
    authContent += '    env: Record<string, string>;\n';
    authContent += '    allowDangerousEmailAccountLinking: boolean;\n';
    authContent += '}) => unknown> = {\n';
    authContent += moduleProviderEntries.length > 0 ? `${moduleProviderEntries.join('\n')}\n` : '';
    authContent += '};\n';
    fs.writeFileSync(AUTH_FILE, authContent);

    const HOOKS_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-hooks.ts');
    let hooksContent = '// Auto-generated hook listener registry - server only\n\n';
    hooksContent += `export const ModuleHookListeners: { hook: string; type: "action" | "filter"; module: string; priority?: number; loader: () => Promise<{ default: (...args: unknown[]) => unknown }> }[] = [\n`;
    for (const hl of allHookListeners) {
        const handlerPath = hl.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${hl.module}/${handlerPath}`;
        hooksContent += `  { hook: ${JSON.stringify(hl.hook)}, type: ${JSON.stringify(hl.type)}, module: ${JSON.stringify(hl.module)}, priority: ${hl.priority ?? 10}, loader: () => import('${importPath}') as Promise<{ default: (...args: unknown[]) => unknown }> },\n`;
    }
    hooksContent += '];\n';
    fs.writeFileSync(HOOKS_FILE, hooksContent);

    const STORAGE_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-storage.ts');
    let storageContent = '// Auto-generated server-only storage provider registry\n\n';
    storageContent += 'export const StorageProviderRegistry: Record<string, () => Promise<{ upload: (buffer: Buffer, filename: string, mimeType: string) => Promise<{ url: string; path: string }> }>> = {\n';
    for (const sp of allStorageProviders) {
        const handlerPath = sp.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${sp.module}/${handlerPath}`;
        storageContent += `  '${sp.id}': () => import('${importPath}').then((mod) => mod.default || mod),\n`;
    }
    storageContent += '};\n\n';
    storageContent += `export const ModuleStorageProviders = ${JSON.stringify(allStorageProviders, null, 2)};\n`;
    fs.writeFileSync(STORAGE_FILE, storageContent);

    // What sends this site's mail. Core used to import a vendor's client and
    // call it, which meant one way to send mail on the whole platform; a
    // transport is a module core loads and calls, like a storage provider.
    const EMAIL_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-email.ts');
    let emailContent = '// Auto-generated server-only email provider registry\n\n';
    emailContent += 'export const EmailProviderRegistry: Record<string, () => Promise<unknown>> = {\n';
    for (const ep of allEmailProviders) {
        const handlerPath = ep.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${ep.module}/${handlerPath}`;
        emailContent += `  '${ep.id}': () => import('${importPath}').then((mod) => mod.default || mod),\n`;
    }
    emailContent += '};\n\n';
    fs.writeFileSync(EMAIL_FILE, emailContent);

    const CRONS_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-crons.ts');
    let cronsContent = '// Auto-generated module cron jobs registry\n\n';
    cronsContent += 'export const ModuleCronJobs: { id: string; schedule: string; module: string; loader: () => Promise<{ default: () => Promise<void> }> }[] = [\n';
    for (const cj of allCronJobs) {
        const handlerPath = cj.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${cj.module}/${handlerPath}`;
        cronsContent += `  { id: ${JSON.stringify(cj.id)}, schedule: ${JSON.stringify(cj.schedule)}, module: ${JSON.stringify(cj.module)}, loader: () => import('${importPath}') as Promise<{ default: () => Promise<void> }> },\n`;
    }
    cronsContent += '];\n';
    fs.writeFileSync(CRONS_FILE, cronsContent);

    // Existence checks for dynamic module routes. Core's catch-all awaits the
    // one matching the route it is about to render and calls notFound() when it
    // answers false, so a URL naming nothing gets a status that says so.
    const RESOLVERS_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-route-resolvers.ts');
    let resolversContent = '// Auto-generated dynamic route existence checks\n\n';
    resolversContent += 'export type RouteResolver = (params: Record<string, string | string[]>) => Promise<boolean>;\n\n';
    resolversContent += 'export const ModuleRouteResolvers: Record<string, () => Promise<{ default: RouteResolver }>> = {\n';
    for (const rr of routeResolvers) {
        const handlerPath = rr.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${rr.module}/${handlerPath}`;
        resolversContent += `  ${JSON.stringify(rr.key)}: () => import('${importPath}') as Promise<{ default: RouteResolver }>,\n`;
    }
    resolversContent += '};\n';
    fs.writeFileSync(RESOLVERS_FILE, resolversContent);
    console.log(`Generated module route resolvers at ${RESOLVERS_FILE} (${routeResolvers.length} route(s))`);

    const SEARCH_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-search.ts');
    let searchContent = '// Auto-generated public search providers registry\n\n';
    searchContent += 'export const ModuleSearchProviders: { id: string; label: string; module: string; icon?: string; loader: () => Promise<{ default: (query: string) => Promise<unknown[]> }> }[] = [\n';
    for (const sp of allSearchProviders) {
        const handlerPath = sp.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${sp.module}/${handlerPath}`;
        const icon = sp.icon ? JSON.stringify(sp.icon) : 'undefined';
        searchContent += `  { id: ${JSON.stringify(sp.id)}, label: ${JSON.stringify(sp.label)}, module: ${JSON.stringify(sp.module)}, icon: ${icon}, loader: () => import('${importPath}') as Promise<{ default: (query: string) => Promise<unknown[]> }> },\n`;
    }
    searchContent += '];\n\n';

    // Full-text indexes the modules own. Core builds the DDL from these
    // identifiers; it no longer carries a hardcoded list of module tables.
    searchContent += 'export const ModuleSearchIndexes: { module: string; table: string; columns: string[] }[] = [\n';
    const seenIndexTables = new Set<string>();
    for (const sp of allSearchProviders) {
        for (const idx of sp.indexes ?? []) {
            // Two providers in one module may name the same table; one index
            // per table is what Postgres wants and what the DDL below emits.
            if (seenIndexTables.has(idx.table)) continue;
            seenIndexTables.add(idx.table);
            searchContent += `  { module: ${JSON.stringify(sp.module)}, table: ${JSON.stringify(idx.table)}, columns: ${JSON.stringify(idx.columns)} },\n`;
        }
    }
    searchContent += '];\n';
    fs.writeFileSync(SEARCH_FILE, searchContent);

    const WEBHOOKS_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-webhooks.ts');
    let webhooksContent = '// Auto-generated inbound webhook receivers registry\n\n';
    webhooksContent += 'export const ModuleWebhookReceivers: { provider: string; module: string; signatureHeader?: string; secretEnv?: string; verifiesInHandler?: boolean; timestampHeader?: string; loader: () => Promise<{ default: (request: Request) => Promise<{ status: number; body?: unknown }> }> }[] = [\n';
    for (const wr of allWebhookReceivers) {
        const handlerPath = wr.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${wr.module}/${handlerPath}`;
        const sigHeader = wr.signatureHeader ? JSON.stringify(wr.signatureHeader) : 'undefined';
        const secretEnv = wr.secretEnv ? JSON.stringify(wr.secretEnv) : 'undefined';
        const verifiesInHandler = wr.verifiesInHandler === true ? 'true' : 'false';
        const tsHeader = wr.timestampHeader ? JSON.stringify(wr.timestampHeader) : 'undefined';
        webhooksContent += `  { provider: ${JSON.stringify(wr.provider)}, module: ${JSON.stringify(wr.module)}, signatureHeader: ${sigHeader}, secretEnv: ${secretEnv}, verifiesInHandler: ${verifiesInHandler}, timestampHeader: ${tsHeader}, loader: () => import('${importPath}') as Promise<{ default: (request: Request) => Promise<{ status: number; body?: unknown }> }> },\n`;
    }
    webhooksContent += '];\n';
    fs.writeFileSync(WEBHOOKS_FILE, webhooksContent);

    const SEO_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-seo.ts');
    let seoContent = '// Auto-generated module SEO sitemap registry - server only\n\n';
    seoContent += 'export interface SitemapEntry {\n';
    seoContent += '    url: string;\n';
    seoContent += '    lastModified?: Date;\n';
    seoContent += "    changeFreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';\n";
    seoContent += '    priority?: number;\n';
    seoContent += '}\n\n';
    seoContent += 'export const ModuleSeoRoutes: { module: string; loader: () => Promise<{ default: () => Promise<SitemapEntry[]> }> }[] = [\n';
    for (const sr of allSeoRoutes) {
        const handlerPath = sr.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${sr.module}/${handlerPath}`;
        seoContent += `  { module: ${JSON.stringify(sr.module)}, loader: () => import('${importPath}') as Promise<{ default: () => Promise<SitemapEntry[]> }> },\n`;
    }
    seoContent += '];\n';
    fs.writeFileSync(SEO_FILE, seoContent);

    const NOTIFTYPES_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-notification-types.ts');
    let notifTypesContent = '// Auto-generated notification types registry\n\n';
    notifTypesContent += `export const ModuleNotificationTypes: { eventType: string; label: string; description?: string; channels?: string[]; module: string }[] = ${JSON.stringify(allNotificationTypes, null, 2)};\n`;
    fs.writeFileSync(NOTIFTYPES_FILE, notifTypesContent);

    const MODERATION_FILE = path.join(path.dirname(OUTPUT_FILE), 'module-moderation.ts');
    let moderationContent = '// Auto-generated moderation provider registry - server only\n\n';
    moderationContent += "export interface ModerationItem {\n";
    moderationContent += "    id: string;\n";
    moderationContent += "    author: { id: string; username: string } | null;\n";
    moderationContent += "    preview: string;\n";
    moderationContent += "    title?: string;\n";
    moderationContent += "    createdAt: Date;\n";
    moderationContent += "    href?: string;\n";
    moderationContent += "}\n\n";
    moderationContent += "export interface ModerationProvider {\n";
    moderationContent += "    count(): Promise<number>;\n";
    moderationContent += "    list(skip: number, take: number): Promise<{ items: ModerationItem[]; total: number }>;\n";
    moderationContent += "    bulkUpdate(ids: string[], newState: 'APPROVED' | 'REJECTED'): Promise<number>;\n";
    moderationContent += "}\n\n";
    moderationContent += "export const ModuleModerationProviders: { id: string; label: string; labelKey?: string; settingKey?: string; settingLabelKey?: string; settingDescKey?: string; module: string; loader: () => Promise<{ default: ModerationProvider }> }[] = [\n";
    for (const mp of allModerationProviders) {
        const handlerPath = mp.handler.replace(/\.tsx?$/, '');
        const importPath = `@/modules/${mp.module}/${handlerPath}`;
        const meta: Record<string, string> = { id: mp.id, label: mp.label, module: mp.module };
        if (mp.labelKey) meta.labelKey = mp.labelKey;
        if (mp.settingKey) meta.settingKey = mp.settingKey;
        if (mp.settingLabelKey) meta.settingLabelKey = mp.settingLabelKey;
        if (mp.settingDescKey) meta.settingDescKey = mp.settingDescKey;
        moderationContent += `  { ...${JSON.stringify(meta)}, loader: () => import('${importPath}') as Promise<{ default: ModerationProvider }> },\n`;
    }
    moderationContent += "];\n";
    fs.writeFileSync(MODERATION_FILE, moderationContent);
}

const ROUTES_OUTPUT_FILE = path.join(process.cwd(), 'src/core/generated/module-routes.ts');

/**
 * Convert a declared module route path (e.g. "/blog/articles/[id]") into a
 * precise regex source string that matches the FULL path. Dynamic segments
 * `[name]` and catch-alls `[...name]` are replaced with non-greedy patterns
 * so two modules that share a prefix (e.g. `/blog/...` vs `/blog/articles`)
 * never cross-gate each other.
 */
function routePathToRegexSource(routePath: string): string {
    // Split into segments and translate dynamic ones individually so we can
    // still escape literal segments safely.
    const segments = routePath.split('/').filter((s) => s.length > 0);
    const parts: string[] = [];
    for (const seg of segments) {
        if (/^\[\.\.\..+\]$/.test(seg)) {
            // catch-all: matches one or more path segments
            parts.push('.+');
        } else if (/^\[.+\]$/.test(seg)) {
            // dynamic single segment
            parts.push('[^/]+');
        } else {
            parts.push(escapeRegex(seg));
        }
    }
    return parts.join('\\/');
}

const PERMISSION_MAP_FILE = path.join(process.cwd(), 'src/core/generated/permission-map.ts');

/**
 * One table saying what opens each path, for the proxy and the sidebar.
 *
 * Both halves of the panel used to answer this differently: the shell asked
 * `isAdmin` and the sidebar drew whatever a manifest listed, so a screen could
 * be linked and refused, or reachable and unlisted. They read this now, and a
 * third reader - the enforcement in the proxy - reads the same rows, so the
 * three cannot drift.
 *
 * Anchored at the end, not a prefix. A prefix rule for `/api/v1/users` also
 * matches `/api/v1/users/me`, which is a member editing their own account: the
 * looser rule would have demanded an operator's permission for it. Each row
 * describes one route, which is what a route file is.
 *
 * Ordered most specific first so `/admin/modules/updates` is answered by its
 * own row rather than by `/admin/modules`.
 */
function specificity(routePath: string): number {
    return routePath.split('/').filter((segment) => segment && !segment.startsWith('[')).length;
}

function generatePermissionMap() {
    const loaded = loadManifests();

    interface Row { pattern: string; permission: string | null; openTo?: string; source: string; declaredPath: string }
    const pages: Row[] = [];
    const writes: Row[] = [];

    for (const screen of CORE_ADMIN_SCREENS) {
        const body = routePathToRegexSource(screen.path);
        pages.push({
            pattern: body ? `/^\\/[a-z]{2}\\/admin\\/${body}\\/?$/` : '/^\\/[a-z]{2}\\/admin\\/?$/',
            permission: screen.permission,
            source: `core ${screen.path}`,
            declaredPath: screen.path,
        });
    }

    for (const route of CORE_ADMIN_API) {
        const body = routePathToRegexSource(route.path.replace(/^\/v1/, ''));
        writes.push({
            pattern: `/^\\/api\\/v1\\/${body}\\/?$/`,
            permission: route.permission,
            source: `core ${route.path}`,
            declaredPath: route.path,
        });
    }

    for (const route of MEMBER_MUTATIONS) {
        const body = routePathToRegexSource(route.path.replace(/^\/v1/, ''));
        writes.push({
            pattern: `/^\\/api\\/v1\\/${body}\\/?$/`,
            permission: null,
            openTo: 'member',
            source: `core ${route.path}`,
            declaredPath: route.path,
        });
    }

    for (const { moduleName, manifest } of loaded) {
        for (const route of manifest.adminRoutes ?? []) {
            const body = routePathToRegexSource(route.path);
            if (!body) continue;
            pages.push({
                pattern: `/^\\/[a-z]{2}\\/admin\\/${body}\\/?$/`,
                permission: route.permission ?? null,
                source: `${moduleName} ${route.path}`,
                declaredPath: route.path,
            });
        }
        for (const api of manifest.api ?? []) {
            if ((api.method ?? 'ALL') === 'GET') continue;
            const body = routePathToRegexSource(api.path);
            if (!body) continue;
            writes.push({
                pattern: `/^\\/api\\/v1\\/${body}\\/?$/`,
                permission: api.permission ?? null,
                openTo: api.providerCallback ? 'public' : api.openTo,
                source: `${moduleName} ${api.path}`,
                declaredPath: api.path,
            });
        }
    }

    const order = (rows: Row[]) =>
        [...rows].sort((a, b) => specificity(b.declaredPath) - specificity(a.declaredPath));

    const emit = (rows: Row[]) =>
        order(rows)
            .map((row) => {
                const open = row.openTo ? `, openTo: "${row.openTo}" as const` : '';
                const permission = row.permission ? `"${row.permission}"` : 'null';
                return `  { pattern: ${row.pattern}, permission: ${permission}${open} }, // ${row.source}`;
            })
            .join('\n');

    const content = `// Auto-generated by scripts/generate-registry.ts - do not edit
//
// What opens each path. Read by the proxy, which refuses a panel path whose
// permission the reader does not hold, and by the sidebar, which draws only
// what it would open.

export interface PermissionRule {
    pattern: RegExp;
    /** The permission that opens it, or null when \`openTo\` says who instead. */
    permission: string | null;
    /** Who a write is for when no permission gates it. */
    openTo?: "member" | "public";
}

export const ADMIN_PAGE_RULES: PermissionRule[] = [
${emit(pages)}
];

export const API_WRITE_RULES: PermissionRule[] = [
${emit(writes)}
];
`;

    fs.writeFileSync(PERMISSION_MAP_FILE, content);
    console.log(`Generated permission map at ${PERMISSION_MAP_FILE} (${pages.length} page rule(s), ${writes.length} write rule(s))`);
}

function generateModuleRoutes() {
    const loaded = loadManifests();
    const modulePatterns: Record<string, Set<string>> = {};
    const providerCallbackPatterns = new Set<string>();

    for (const { moduleName, manifest } of loaded) {
        const patterns = new Set<string>();

        for (const route of manifest.routes ?? []) {
            const body = routePathToRegexSource(route.path);
            if (body) {
                patterns.add(`/^\\/[a-z]{2}\\/${body}(?:\\/|$)/`);
            }
        }

        for (const route of manifest.adminRoutes ?? []) {
            const body = routePathToRegexSource(route.path);
            if (body) {
                patterns.add(`/^\\/[a-z]{2}\\/admin\\/${body}(?:\\/|$)/`);
            }
        }

        for (const api of manifest.api ?? []) {
            const body = routePathToRegexSource(api.path);
            if (body) {
                patterns.add(`/^\\/api\\/v1\\/${body}(?:\\/|$)/`);
                if (api.providerCallback) {
                    // Anchored to the end of the path, unlike the route-map
                    // pattern above. That one exists to say "this subtree
                    // belongs to this module" and a prefix match is right for
                    // it. This one turns the CSRF gate off, and a prefix match
                    // there is a hole: a callback declared at `/[provider]`
                    // produced `/^\/api\/v1\/[^\/]+(?:\/|$)/`, which matches
                    // `/api/v1/users/me` and every other route in the product.
                    // One manifest entry disabled the origin check for the
                    // whole API. An exemption covers the endpoint that asked
                    // for it and nothing below it.
                    providerCallbackPatterns.add(`/^\\/api\\/v1\\/${body}\\/?$/`);
                }
            }
        }

        if (patterns.size > 0) {
            modulePatterns[moduleName] = patterns;
        }
    }

    let output = '// Auto-generated by scripts/generate-registry.ts - do not edit\n';
    output += 'export const moduleRouteMap: Record<string, RegExp[]> = {\n';
    for (const [moduleName, patterns] of Object.entries(modulePatterns)) {
        output += `  "${moduleName}": [\n`;
        for (const pattern of patterns) output += `    ${pattern},\n`;
        output += `  ],\n`;
    }
    output += '};\n\n';

    // Endpoints an external service posts to with no browser behind it, so
    // no Origin header and nothing for the CSRF gate to match. Each handler
    // authenticates the request itself; validate-module enforces that.
    output += '// Module endpoints exempt from the CSRF origin check.\n';
    output += 'export const providerCallbackRoutes: RegExp[] = [\n';
    for (const pattern of providerCallbackPatterns) output += `  ${pattern},\n`;
    output += '];\n';

    const dir = path.dirname(ROUTES_OUTPUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ROUTES_OUTPUT_FILE, output);
    console.log(`Generated module routes at ${ROUTES_OUTPUT_FILE}`);
}

const CSP_OUTPUT_FILE = path.join(process.cwd(), 'src/core/generated/module-csp.json');

/**
 * Collect the external origins the installed modules need in the CSP.
 *
 * Core's policy is one fixed list built in `next.config.ts`, and a module has
 * no way to reach it from there - which is why the Discord widget's iframe and
 * the Google Analytics tag both rendered nothing while core's own `frame-src`
 * named two payment origins that nothing loads. JSON rather than a TypeScript
 * module because `next.config.ts` reads this with `fs`: it is loaded by Next's
 * own config loader in dev, build and start alike, and a plain file read
 * behaves the same in all three.
 *
 * The manifest schema has already refused anything but a concrete https
 * origin, so nothing here can widen the policy beyond naming a host.
 */
function generateModuleCsp() {
    const loaded = loadManifests();
    const byDirective: Record<string, Set<string>> = {};

    for (const { manifest } of loaded) {
        for (const [directive, origins] of Object.entries(manifest.csp ?? {})) {
            if (!Array.isArray(origins)) continue;
            byDirective[directive] ??= new Set<string>();
            for (const origin of origins) byDirective[directive].add(origin);
        }
    }

    const out: Record<string, string[]> = {};
    for (const directive of Object.keys(byDirective).sort()) {
        out[directive] = [...byDirective[directive]].sort();
    }

    const dir = path.dirname(CSP_OUTPUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CSP_OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');
    const total = Object.values(out).reduce((n, o) => n + o.length, 0);
    console.log(`Generated module CSP contributions at ${CSP_OUTPUT_FILE} (${total} origin(s))`);
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

generateRegistry();
generateModuleRoutes();
generatePermissionMap();
generateModuleCsp();
