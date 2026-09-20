import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    // React 19 added a family of stricter hook rules (set-state-in-effect,
    // purity, no-deriving-state-in-effects, etc.) that didn't exist when
    // this codebase was authored. The rewrites they want are functional
    // refactors - not a safe automated sweep. Until the dedicated React 19
    // migration pass lands, these rules stay off so legitimate pre-existing
    // `useEffect(() => { setState(...) }, [deps])` flows don't drown every
    // other lint signal.
    //
    // react-hooks/exhaustive-deps stays at "warn" because those cases are
    // mostly a missing `t` from useTranslations (stable reference) and can
    // be fixed per-site when touched.
    {
        plugins: { "react-hooks": reactHooks },
        rules: {
            "react-hooks/set-state-in-effect": "off",
            "react-hooks/purity": "off",
            "react-hooks/no-deriving-state-in-effects": "off",
            "react-hooks/static-components": "off",
            "react-hooks/preserve-manual-memoization": "off",
            "react-hooks/immutability": "off",
            "react-hooks/refs": "off",
            "react-hooks/error-boundaries": "off",
            "react-hooks/set-state-in-render": "warn",
            "react-hooks/exhaustive-deps": "warn",
        },
    },
    // CommonJS bootstrap files (PM2 ecosystem config, etc.) use require() by
    // spec - disable the TS "no-require-imports" rule for .cjs only.
    {
        files: ["**/*.cjs"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
    // Underscore-prefixed identifiers are the conventional opt-out for
    // "intentionally unused" (params we keep for interface shape, catch
    // bindings we don't inspect, destructured keys we skip). The TS rule
    // doesn't honor that by default - configure it explicitly.
    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                },
            ],
        },
    },
    // Module sources are NOT subject to the core platform's lint bar - each
    // module has its own quality profile, which is why every stylistic rule is
    // switched off below. Exactly one rule is enforced, and it is
    // architectural rather than stylistic: a module must import core through
    // the published SDK, never through core's internal layout.
    //
    // This is editor feedback, not the gate. ESLint can't see a third-party
    // ZIP; `scripts/validate-module.ts` (run by build-marketplace.sh and CI)
    // is what actually holds the boundary.
    {
        files: ["module-sources/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-unused-vars": "off",
            "react-hooks/exhaustive-deps": "off",
            "@next/next/no-img-element": "off",
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@/core/lib",
                                "@/core/lib/*",
                                "@/core/components",
                                "@/core/components/*",
                            ],
                            message:
                                "Modules must import core through the SDK: @/core/sdk (isomorphic), or one of @/core/sdk/{server,auth,navigation,blocks,theme,ui,layout,admin}. Run `npx tsx scripts/migrate-module-imports.ts <path>` to rewrite.",
                        },
                    ],
                },
            ],
        },
        linterOptions: {
            // The module sources carry their own eslint-disable comments for
            // rules this block switches off; don't report them as unused.
            reportUnusedDisableDirectives: false,
        },
    },

    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        ".next/**",
        // Build output under a NEXT_DIST_DIR chosen so a build can run while
        // the dev server keeps `.next`. Generated either way.
        ".next-*/**",
        "out/**",
        "build/**",
        "next-env.d.ts",
        // Generated artifacts - never owned by humans.
        "src/core/generated/**",
        // Throwaway Prisma client built by scripts/typecheck-modules.ts.
        ".typecheck-modules/**",
        "src/generated/**",
        // The installed runtime copy of a module is generated state, never
        // hand-edited - lint the authoritative source instead.
        "src/modules/**",
        // v8 coverage report. Gitignored, but present on any machine that has
        // run `npm run test:coverage` - and its vendored HTML helpers carry
        // eslint-disable directives that trip --max-warnings=0. CI only
        // avoided this because it lints before it runs the suite.
        "coverage/**",
        // This repository's own scratch directory (see scripts/with-scratch.sh).
        // A run puts whatever it likes here - a backup of a file being edited,
        // a fixture, a copy of a module - and a copy of a source file is still
        // a source file to a linter, so the lint pass started reporting
        // warnings against paths nobody is going to edit.
        ".tmp/**",
    ]),
]);

export default eslintConfig;
