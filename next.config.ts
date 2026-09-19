import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import createNextIntlPlugin from 'next-intl/plugin';
import withBundleAnalyzer from '@next/bundle-analyzer';

const withNextIntl = createNextIntlPlugin('./src/core/lib/i18n/request.ts');
const analyzeBundles = withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

/**
 * Origins the installed modules asked the CSP to allow.
 *
 * Written by scripts/generate-registry.ts, which both `predev` and `prebuild`
 * run before Next loads this file. Read rather than imported so a checkout
 * that has never generated one still builds: an absent file is no modules
 * installed, which is what a fresh core is. The manifest schema has already
 * refused anything but a concrete https origin, so a module can name a host
 * and nothing else.
 */
function moduleCspOrigins(): Record<string, string[]> {
  try {
    const raw = readFileSync(join(process.cwd(), 'src/core/generated/module-csp.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [directive, origins] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(origins)) continue;
      const safe = origins.filter(
        (o): o is string => typeof o === 'string' && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(o),
      );
      if (safe.length > 0) out[directive] = safe;
    }
    return out;
  } catch {
    return {};
  }
}

const isDev = process.env.NODE_ENV === 'development';

// Hosts allowed to pull Next's dev-only /_next/* resources (client chunks,
// the HMR websocket). Next rejects a bare '*' on purpose - its matcher
// refuses any wildcard that would match a whole host - so an allowlist of
// '*' silently blocks EVERY non-localhost origin with a 403, which reads as
// "the page renders but never hydrates". List real hosts instead, derived
// from the same env URLs src/core/lib/csrf.ts trusts, plus
// NEXT_DEV_ALLOWED_ORIGINS for anything extra (comma-separated hostnames).
function devOriginHosts(): string[] {
  const hosts = new Set<string>();
  for (const raw of [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname);
    } catch {
      // Ignore malformed URLs - the app surfaces those elsewhere.
    }
  }
  for (const part of (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? '').split(',')) {
    const host = part.trim();
    if (host) hosts.add(host);
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  // output: "standalone", // Disabled: modules need full node_modules for runtime registry generation
  poweredByHeader: false,
  // A production build and `next dev` write to the same `.next` by default,
  // so building to measure a page costs whoever is using the dev server their
  // session. Naming a different directory lets both stand at once, which is
  // the only way to compare a dev page against the build it will ship as.
  // Unset everywhere that matters, so the default is what CI and deploys get.
  // Next adds whichever directory it built to `tsconfig.json`'s include on
  // its way through, so a build under this variable leaves that one line to
  // put back.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  ...(isDev ? { allowedDevOrigins: devOriginHosts() } : {}),
  serverExternalPackages: ["redis", "net", "fs", "dns", "tls", "pg", "@prisma/adapter-pg", "@aws-sdk/client-s3"],
  images: {
    remotePatterns: [
      // Allow any user-provided image URL (Next.js image optimization is read-only fetch+resize)
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    // Allow SVG avatars (DiceBear and similar). The optimizer serves them
    // with a strict CSP and Content-Disposition: attachment so an SVG
    // can't execute scripts in the page context if a user supplies a
    // malicious URL.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'none'; script-src 'none'; sandbox;",
    contentDispositionType: "attachment",
  },
  async headers() {
    // Production-grade security header set.
    //
    //  - frame-ancestors 'self' + X-Frame-Options: SAMEORIGIN are required by the
    //    admin theme customizer iframe. Do not loosen.
    //  - style-src keeps 'unsafe-inline' because Tailwind JIT injects CSS via
    //    inline <style> during hydration. Moving to a nonce needs matching
    //    middleware threading and is tracked separately.
    //  - script-src drops 'unsafe-eval' from the *production* policy - Next.js
    //    16 / React 19 no longer need eval() at runtime there. React's
    //    DEVELOPMENT build does eval() (callstack reconstruction across
    //    environments, Turbopack HMR), so dev adds it back or the client
    //    never hydrates. Swagger UI at /admin/api-docs needs it in every
    //    mode, so that route gets its own header override below.
    //  - every fetch directive is core's own sources plus the origins the
    //    installed modules declared in their manifests. Core names no module's
    //    host: it used to carry two payment origins that no gateway loaded,
    //    while the Discord widget iframe and the Google Analytics tag were
    //    blocked outright with nothing to say so but the browser console.

    const moduleOrigins = moduleCspOrigins();
    /** Core's own sources for a directive, plus whatever the modules declared. */
    const directive = (name: string, ...sources: string[]) =>
      [name, ...sources, ...(moduleOrigins[name] ?? [])].join(' ');

    const buildCsp = (unsafeEval: boolean) => [
      "default-src 'self'",
      // Tailwind JIT + Next.js hydration need inline script/style.
      // static.cloudflareinsights.com hosts the beacon Cloudflare auto-
      // injects when Web Analytics is enabled for the zone; without it
      // the browser logs a CSP violation on every page load.
      directive('script-src', `'self'`, `'unsafe-inline'`, ...(unsafeEval ? [`'unsafe-eval'`] : []), 'https://static.cloudflareinsights.com'),
      // No third party stylesheet is fetched at runtime. A dependency's CSS
      // once opened with an @import for Inter from rsms.me, which
      // scripts/postcss-drop-remote-imports.mjs removes on the way through;
      // this app self hosts Inter through next/font. That origin is not named
      // here, so if the strip ever stops working the browser refuses the
      // request rather than quietly making it.
      directive('style-src', `'self'`, `'unsafe-inline'`, 'https://fonts.googleapis.com'),
      directive('img-src', `'self'`, 'data:', 'blob:', 'https:'),
      directive('font-src', `'self'`, 'https://fonts.gstatic.com', 'data:'),
      // The dev HMR socket is ws:// whenever the app is served over plain
      // HTTP, which wss: alone does not cover.
      directive('connect-src', `'self'`, 'https:', 'wss:', ...(isDev ? ['ws:'] : [])),
      "frame-ancestors 'self'",
      // No gateway origins here. Core naming a module's hosts was wrong twice
      // over: neither payment module ever loaded the two that used to sit in
      // this list, and the origins that are genuinely needed belong to
      // whichever modules are installed. They declare them; see `csp` in the
      // manifest schema.
      directive('frame-src', `'self'`),
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ');

    const baseCsp = buildCsp(isDev);

    // /admin/api-docs runs a third-party Swagger UI bundle that still eval()s
    // its own spec loader; we narrow the looser policy to that path instead
    // of applying unsafe-eval to the entire site in production.
    const swaggerCsp = buildCsp(true);

    const commonHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      // Block Flash / Acrobat cross-domain policy file lookups.
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
      // Spectre / cross-origin process isolation - strong defaults that
      // don't break current pages. Revisit if modules embed third-party
      // widgets that need postMessage access across origins.
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ];

    // Order decides this, not specificity. Next applies every rule whose
    // source matches and a later one wins on a key it repeats, so the
    // exception has to come after the rule it excepts. Listed the other way
    // round, `/en/admin/api-docs` and `/en` answered with byte-identical
    // policies and the one page that needs eval was the one page without it.
    return [
      {
        source: '/(.*)',
        headers: [
          ...commonHeaders,
          { key: 'Content-Security-Policy', value: baseCsp },
        ],
      },
      {
        source: '/:locale/admin/api-docs/:path*',
        headers: [
          ...commonHeaders,
          { key: 'Content-Security-Policy', value: swaggerCsp },
        ],
      },
      // An uploaded SVG is a document served from this origin, and the site
      // policy above allows inline script because the app's own pages need
      // it. `images` already refuses to serve one that way through the
      // optimizer; this says the same thing for the address the bytes have on
      // disk. The route that reads them cannot: a file that exists under
      // `public/uploads` is answered by the static handler and the route never
      // runs, while a header rule applies whichever one serves it.
      {
        source: '/uploads/:path*.svg',
        headers: [
          ...commonHeaders,
          { key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'none'; sandbox;" },
        ],
      },
    ];
  },
};

export default analyzeBundles(withNextIntl(nextConfig));
