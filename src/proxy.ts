import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './core/lib/i18n/config';
import { carriesSessionCookie } from './core/lib/session-cookie';
import { moduleRouteMap } from '@/core/generated/module-routes';
import { randomUUID } from 'crypto';
import { isSetupComplete } from '@/core/lib/setup-state';
import { getMaintenanceConfig } from '@/core/lib/maintenance';
import { auth } from '@/core/lib/auth';
import prisma from '@/core/lib/db';
import { isIpBlocked, type IpBlockScope } from '@/core/lib/ip-blocks';
import { getModuleStates } from '@/core/lib/module-cache';
import { checkCsrf } from '@/core/lib/csrf';
import { hasControlCharacter } from '@/core/lib/request-path';
import { providerCallbackRoutes } from '@/core/generated/module-routes';
import { runWithLogContext } from '@/core/lib/logger';
import { getClientIP } from '@/core/lib/rate-limit';
import { isStaticAsset } from '@/core/lib/proxy-paths';
import { safeInternalPath } from '@/core/lib/safe-redirect';
import { siteRedirects } from '@/core/lib/redirects';
import { resolveRedirect } from '@/core/lib/redirect-resolve';
import { ensureHooks } from '@/core/lib/hooks-bootstrap';
import { isBlockedInDemo } from '@/core/lib/demo-guard';
import { panelReaderFor } from '@/core/lib/permissions';
import { mayEnterPanel, mayOpenAdminPath } from '@/core/lib/admin-access';

const intlMiddleware = createIntlMiddleware({
    locales: locales,
    defaultLocale: defaultLocale,
    localePrefix: 'always'
});

/**
 * The ceiling on a request body, which is the image upload ceiling in
 * `storage.ts` plus room for multipart framing. Nothing legitimate is larger;
 * JSON endpoints stop far earlier, in `readJsonBody`.
 */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

function getModuleForPath(pathname: string): string | null {
    for (const [moduleId, patterns] of Object.entries(moduleRouteMap)) {
        for (const pattern of patterns) {
            if (pattern.test(pathname)) {
                return moduleId;
            }
        }
    }
    return null;
}

/**
 * Resolve a single module's enabled flag. We hit the shared module state
 * cache directly (Redis when available, in-memory fallback) - no internal
 * HTTP round-trip. Next.js 16 runs middleware in Node runtime so direct
 * Prisma reads via getModuleStates are safe here.
 *
 * Unknown module IDs default to "enabled" - a module that has routes in the
 * registry but no ModuleConfig row is assumed on until an admin toggles it
 * off. Failing open is preferable to black-holing traffic during a DB blip.
 */
async function getModuleEnabled(moduleId: string): Promise<boolean> {
    try {
        const states = await getModuleStates();
        return states[moduleId] ?? true;
    } catch {
        return true;
    }
}

function extractLocale(pathname: string): string {
    const match = pathname.match(/^\/([a-z]{2})(?:\/|$)/);
    if (match && (locales as readonly string[]).includes(match[1])) {
        return match[1];
    }
    return defaultLocale;
}

/**
 * Use the shared trust-aware client IP helper from rate-limit.ts so
 * TRUSTED_PROXY_IPS is honored uniformly. A prior inline version trusted
 * x-forwarded-for unconditionally, which let attackers behind any proxy
 * spoof their IP to bypass /admin/ip-blocks rules.
 */
function getClientIpFromRequest(request: NextRequest): string {
    return getClientIP(request.headers);
}

function resolveIpScope(pathname: string): IpBlockScope {
    if (/^\/[a-z]{2}\/admin(\/|$)/.test(pathname)) return 'admin';
    if (pathname.startsWith('/api/v1/admin')) return 'admin';
    if (pathname.startsWith('/api/')) return 'api';
    return 'all';
}

/** See `carriesSessionCookie`: a question about a cookie's name, not the header's text. */
function hasSessionCookie(request: NextRequest): boolean {
    return carriesSessionCookie(request.headers.get('cookie'));
}

/**
 * Best-effort session-role extraction for middleware gating.
 * Returns "guest" when there is no session or when the lookup fails so
 * the caller can safely treat them as an unprivileged visitor.
 */
async function getSessionRole(request: NextRequest): Promise<string> {
    if (!hasSessionCookie(request)) return 'guest';

    try {
        const session = await auth();
        const userId = session?.user?.id;
        if (!userId) return 'guest';
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: { select: { name: true } } },
        });
        return user?.role?.name || 'guest';
    } catch {
        return 'guest';
    }
}

async function proxyImpl(request: NextRequest, correlationId: string): Promise<NextResponse> {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-correlation-id', correlationId);

    const { pathname } = request.nextUrl;

    // ===== Control characters in the path =====
    // A control character has no meaning in a URL path, and letting one
    // through cost two things. next-intl's middleware strips a trailing
    // segment that is nothing but one, so `/en/store/%00` answered 200 with
    // the store page and `/en/%00` with the homepage - every page on the site
    // had an unbounded supply of URLs that reported 200 for content that is
    // not there, which is a soft 404 to a crawler and a false green to a link
    // checker or an uptime monitor. And a layer that strips a character while
    // the gates below match on the string that still has it is exactly how a
    // gate gets walked past; `%0a` in a path also forges a line in any log
    // that formats rather than encodes.
    //
    // Both spellings are refused: the literal character, and the percent
    // escape, because which one reaches here depends on the layer that
    // normalised it.
    if (hasControlCharacter(pathname)) {
        return pathname.startsWith('/api/')
            ? NextResponse.json({ error: 'Invalid path', code: 'invalid_path' }, { status: 400 })
            : new NextResponse('Invalid path', { status: 400 });
    }

    // The same rule for the query, which had no rule at all. A `%00` in any
    // value that reached a Prisma string filter answered 500 - Postgres text
    // cannot hold a null byte, so the driver threw where a handler had
    // nothing to say - and `/api/v1/punishments?search=%00` was one of many:
    // every endpoint that passes a search term or a filter into a query was
    // another. A control character is not something a person typed into a
    // search box, so it is refused here rather than stripped at each of the
    // dozens of places it can reach.
    if (hasControlCharacter(request.nextUrl.search)) {
        return pathname.startsWith('/api/')
            ? NextResponse.json({ error: 'Invalid query', code: 'invalid_query' }, { status: 400 })
            : new NextResponse('Invalid query', { status: 400 });
    }

    // ===== Absolute body ceiling =====
    // App Router route handlers have no body limit of their own, so the only
    // bound on an inbound request used to be whatever a handler imposed after
    // it had already buffered the whole thing. `readJsonBody` caps JSON at a
    // megabyte and `storage.ts` caps an upload at fifty, but both of those
    // measure a body they have already read. This refuses a request whose own
    // declared length is past anything the application accepts, before a
    // handler runs at all. A body with no content-length, or one that lies,
    // still meets the per-handler cap that reads it as a stream.
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        return NextResponse.json(
            { error: 'Request body too large', code: 'body_too_large' },
            { status: 413 },
        );
    }

    // ===== Demo write gate =====
    // On the public demo instance (DEMO_MODE=1) any visitor can log in as
    // the seeded admin. Block the handful of admin actions that would brick
    // the demo for everyone else - see isBlockedInDemo() for the full list.
    if (process.env.DEMO_MODE === '1' && isBlockedInDemo(request.method, pathname)) {
        // The `code` matters as much as the sentence: without it every
        // screen turned a deliberate demo refusal into its own generic "could
        // not save", so a blocked action was indistinguishable from a broken
        // one - which is exactly how it was read.
        return NextResponse.json(
            {
                error: 'This action is disabled in the demo. Spin up your own instance to try it.',
                code: 'demo_disabled',
            },
            { status: 403 },
        );
    }

    // ===== CSRF gate =====
    // NextAuth handles /api/auth/* itself; inbound webhooks are exempt because
    // external services POST them without a browser origin. Everything else
    // gets a same-origin check to prevent cross-site cookie-riding attacks.
    //
    // The two literal prefixes below only ever matched core's own webhook
    // route. A payment gateway ships its callback at whatever path its
    // manifest declares - /api/v1/mollie/webhook, /api/v1/webhooks/stripe -
    // and every one of them was answered 403 here before its handler ran, so
    // no payment settled. Core cannot know those paths, so the module marks
    // the endpoint `providerCallback` and the generated list says which they
    // are. Each such handler verifies a signature or reads the payment back
    // from the provider itself; validate-module fails one that does neither.
    if (
        pathname.startsWith('/api/') &&
        !pathname.startsWith('/api/auth/') &&
        !pathname.startsWith('/api/v1/webhook/') &&
        !pathname.startsWith('/api/webhook/') &&
        !providerCallbackRoutes.some((route) => route.test(pathname))
    ) {
        const csrf = checkCsrf(request);
        if (!csrf.ok) {
            return NextResponse.json(
                { ok: false, error: 'Origin not allowed', code: 'csrf_rejected' },
                { status: 403 },
            );
        }
    }

    const moduleId = getModuleForPath(pathname);

    if (moduleId) {
        const isEnabled = await getModuleEnabled(moduleId);

        if (!isEnabled) {
            if (pathname.startsWith('/api/')) {
                return NextResponse.json(
                    { error: 'Module not enabled', module: moduleId },
                    { status: 404 }
                );
            }

            const locale = pathname.match(/^\/([a-z]{2})\//)?.[1] || 'en';
            const url = new URL(`/${locale}/not-found`, request.url);
            return NextResponse.rewrite(url, { status: 404 });
        }
    }

    // ===== Setup wizard gate =====
    // Force every visitor through the wizard until at least one user exists.
    // The setup API itself stays reachable so the wizard can post back.
    if (!isStaticAsset(pathname) && !pathname.startsWith('/api/setup')) {
        const setupDone = await isSetupComplete();
        const locale = extractLocale(pathname);
        const setupPath = `/${locale}/setup`;
        const isOnSetup =
            pathname === setupPath || pathname.startsWith(`${setupPath}/`);

        if (!setupDone && !isOnSetup) {
            if (pathname.startsWith('/api/')) {
                return NextResponse.json(
                    { error: 'Setup required', redirectTo: setupPath },
                    { status: 503 }
                );
            }
            const url = new URL(setupPath, request.url);
            return NextResponse.rewrite(url);
        }

        // The gate used to be one-directional: it forced visitors onto the
        // wizard but never sent them back off it. A live site therefore still
        // served the wizard at /setup - its steps empty, because every
        // /api/setup route answers 409 once a user exists.
        if (setupDone && isOnSetup) {
            return NextResponse.redirect(new URL(`/${locale}`, request.url));
        }
    }

    // ===== Moved pages =====
    // After the setup gate, so a half-built site is not redirected around its
    // own wizard, and before everything else, because a page that has moved
    // has moved for every visitor whatever else is true of them. Pages only:
    // an API address is a contract, not a link somebody bookmarked.
    if (!isStaticAsset(pathname) && !pathname.startsWith('/api/')) {
        // The bus is bootstrapped per module graph, and the proxy is its own.
        // Without this the filter finds no listeners and answers with the
        // empty list it was given - no error, no log line, no redirects.
        await ensureHooks();
        const rules = await siteRedirects();
        if (rules.length > 0) {
            const locale = extractLocale(pathname);
            const moved = resolveRedirect(pathname + request.nextUrl.search, locale, rules);
            if (moved) {
                return NextResponse.redirect(
                    new URL(moved.to, request.url),
                    // 308 and 307 rather than 301 and 302: both keep the
                    // method, and a browser that cached a 301 keeps it for
                    // ever, which is the wrong thing to be sure about.
                    moved.permanent ? 308 : 307,
                );
            }
        }
    }

    // ===== Maintenance mode gate =====
    // Admins (and any allowlisted roles) keep access. Auth endpoints stay open
    // so admins can sign in; the maintenance toggle API stays open so they can
    // turn it off; the internal module-status API is exempt to avoid a loop.
    if (!isStaticAsset(pathname)) {
        const locale = extractLocale(pathname);
        const maintenancePath = `/${locale}/maintenance`;
        const authPrefix = `/${locale}/auth`;
        const isOnMaintenancePage =
            pathname === maintenancePath || pathname.startsWith(`${maintenancePath}/`);
        const isOnAuthPage = pathname.startsWith(authPrefix);
        const isSetupPath =
            pathname === `/${locale}/setup` || pathname.startsWith(`/${locale}/setup/`);
        const isAuthApi = pathname.startsWith('/api/auth');
        const isInternalApi = pathname === '/api/v1/modules/status';
        const isMaintenanceApi = pathname === '/api/v1/admin/maintenance';

        if (
            !isOnMaintenancePage && !isOnAuthPage && !isSetupPath &&
            !isAuthApi && !isInternalApi && !isMaintenanceApi
        ) {
            const config = await getMaintenanceConfig();
            if (config.enabled) {
                const allowedRoles = config.allowedRoles?.length
                    ? config.allowedRoles
                    : ['admin'];
                const role = await getSessionRole(request);

                if (!allowedRoles.includes(role)) {
                    if (pathname.startsWith('/api/')) {
                        return NextResponse.json(
                            { error: 'Service Unavailable', maintenance: true },
                            { status: 503 }
                        );
                    }
                    const url = new URL(maintenancePath, request.url);
                    return NextResponse.rewrite(url, { status: 503 });
                }
            }
        }
    }

    // ===== IP blocklist gate =====
    // Block list is cached in-process for 60s. `isIpBlocked` fails open on DB
    // errors - a DB outage must never lock every visitor out. Skipped until
    // setup completes so a stale rule can't lock the operator out of the
    // initial install screen before they whitelist their own IP.
    if (!isStaticAsset(pathname) && (await isSetupComplete())) {
        const clientIp = getClientIpFromRequest(request);
        const ipScope = resolveIpScope(pathname);
        try {
            if (await isIpBlocked(clientIp, ipScope)) {
                return new NextResponse('Access denied', { status: 403 });
            }
        } catch {
            // Fail-open: a loader error must not block visitors.
        }
    }

    // ===== A signed-out deep link keeps its destination =====
    // An admin who opens a bookmarked /admin/media is sent to the login form
    // by the admin layout's guard, and that guard cannot say where they were
    // going: a layout is not given the pathname, by design, because it does
    // not re-render on navigation. So the redirect dropped the destination and
    // the admin, having signed in, landed on the homepage instead.
    //
    // Deciding this here is a routing choice, not an authorization one. The
    // layout still makes that call, against a real session, and still makes it
    // for every request; all that is settled here is which URL a visitor
    // carrying no session cookie at all is sent to. Nothing downstream trusts
    // this beyond a query string, and the login form validates it again before
    // following it.
    if (!isStaticAsset(pathname) && !pathname.startsWith('/api/')) {
        const locale = extractLocale(pathname);
        const adminPrefix = `/${locale}/admin`;
        const isAdminPage =
            pathname === adminPrefix || pathname.startsWith(`${adminPrefix}/`);

        if (isAdminPage && !hasSessionCookie(request)) {
            const url = new URL(`/${locale}/auth/login`, request.url);
            const destination = safeInternalPath(
                pathname.slice(`/${locale}`.length) + request.nextUrl.search,
            );
            if (destination) url.searchParams.set('callbackUrl', destination);
            return NextResponse.redirect(url);
        }

        // ===== Which part of the panel this reader may open =====
        // The table saying which permission opens which panel path has been
        // generated for a long time and nothing read it, so every `admin.*`
        // permission the roles screen offers changed nothing: the shell asked
        // `isAdmin` and that was the whole of it.
        //
        // This is the only place that knows both the path and the reader. A
        // layout is not given the pathname, by design, so it can refuse the
        // building but not the room. It still refuses the building - see
        // `mayEnterPanel` there - and this refuses the room.
        //
        // An administrator is unaffected: `isAdmin` opens everything, exactly
        // as before, so nobody who could reach a screen yesterday cannot
        // today. Somebody inside the panel who lacks this screen is sent to
        // the panel's front door rather than off the site, because they do
        // belong here.
        if (isAdminPage && hasSessionCookie(request)) {
            try {
                const session = await auth();
                const reader = await panelReaderFor(session?.user?.id);
                if (!mayEnterPanel(reader)) {
                    return NextResponse.redirect(new URL(`/${locale}`, request.url));
                }
                if (!mayOpenAdminPath(reader, pathname)) {
                    return NextResponse.redirect(new URL(`/${locale}/admin`, request.url));
                }
            } catch {
                // A lookup that fell over must not lock the panel: the shell
                // asks again against a real session and refuses there.
            }
        }
    }

    if (!pathname.startsWith('/api/')) {
        const response = intlMiddleware(request);
        response.headers.set('x-correlation-id', correlationId);
        return response;
    }

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-correlation-id', correlationId);
    return response;
}

export async function proxy(request: NextRequest) {
    // Bind the correlation id to async-local context so every nested log call
    // (including those inside module hooks and awaited handlers) auto-tags
    // its output with this id. See core/lib/logger.ts.
    const correlationId = request.headers.get('x-correlation-id') || randomUUID();
    return runWithLogContext({ correlationId }, () => proxyImpl(request, correlationId));
}

export const config = {
    matcher: [
        // Pages and everything else, minus Next internals and anything that
        // looks like a file in /public.
        '/((?!api|_next|_vercel|.*\\..*).*)',
        // API routes unconditionally. The pattern above drops any path
        // containing a dot, and an API id is allowed to contain one, so
        // `DELETE /api/v1/store/products/1.` used to reach the handler
        // without passing the CSRF, IP blocklist, maintenance, setup,
        // module-enabled or demo-write gates that all live in this file.
        '/api/:path*',
    ]
};
