/**
 * A theme's own stylesheet, scoped to the theme that wrote it.
 *
 * Every installed theme's CSS is compiled into the one stylesheet the site
 * serves, so a rule written as `.card { ... }` would draw on every site that
 * has the theme installed, whichever theme it is wearing. Each selector is
 * prefixed with `[data-theme="<id>"]`, the attribute the layout writes on
 * `html`, so an author writes plain selectors and cannot forget the scope.
 * `html` and `:root` name that element itself, since a descendant of it
 * called `html` does not exist.
 *
 * An `@import` is dropped rather than scoped: it would pull another
 * stylesheet into the build from wherever it pointed, unscoped. Keyframe
 * steps are not selectors and are left as written.
 */
import postcss, { type Rule } from "postcss";

const THEME_ID = /^[a-z0-9][a-z0-9-]*$/;
const ROOT_ELEMENT = /^(?::root|html)(?![\w-])/;

function scopeSelector(scope: string, selector: string): string {
    const trimmed = selector.trim();
    if (ROOT_ELEMENT.test(trimmed)) return trimmed.replace(ROOT_ELEMENT, scope);
    return `${scope} ${trimmed}`;
}

export function scopeThemeStylesheet(themeId: string, css: string): string {
    if (!THEME_ID.test(themeId)) throw new Error(`"${themeId}" is not a theme id`);
    const scope = `[data-theme="${themeId}"]`;
    const root = postcss.parse(css);
    root.walkAtRules("import", (rule) => {
        rule.remove();
    });
    const steps = new Set<Rule>();
    root.walkAtRules(/keyframes$/i, (keyframes) => {
        keyframes.walkRules((step) => {
            steps.add(step);
        });
    });
    root.walkRules((rule) => {
        if (steps.has(rule)) return;
        rule.selectors = rule.selectors.map((s) => scopeSelector(scope, s));
    });
    return root.toString();
}
