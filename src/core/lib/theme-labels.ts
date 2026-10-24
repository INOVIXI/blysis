/**
 * The admin key a theme's colour is named by.
 *
 * A theme may name its own key. Otherwise the colour is one of the names
 * every theme shares, `primary` or `card`, and core's catalogue holds it
 * under `theme_color_<name>`.
 * `tests/unit/a-theme-colour-is-named-in-the-panels-language.test.ts`.
 */
export function colorLabelKey(name: string, labelKey?: string): string {
    return labelKey ?? `theme_color_${name}`;
}
