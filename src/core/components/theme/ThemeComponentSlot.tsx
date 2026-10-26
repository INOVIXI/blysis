"use client";

import { useTheme } from "@/core/providers/theme-provider";
import { getThemeComponent } from "@/core/generated/theme-components";
import type { ComponentType, ReactNode } from "react";

/**
 * Render a named component, preferring the active theme's override if any.
 * Wrap every core layout component that a theme may legitimately replace.
 *
 * `fallback` is optional - slots whose only purpose is to host an override
 * (e.g. theme-owned Hero on a public module page) can omit it and render
 * nothing when no theme provides the named component. Passing a function
 * here only works from another client boundary; RSC pages should either
 * omit `fallback` or wrap their server fallback in a Client Component.
 */
export function ThemeComponentSlot<P extends object>({
    name,
    fallback: Fallback,
    ...rest
}: {
    name: string;
    fallback?: ComponentType<P>;
} & P): ReactNode {
    const { activeTheme } = useTheme();
    const Override = getThemeComponent(activeTheme?.id ?? "", name) as ComponentType<P> | null;
    const Comp = (Override ?? Fallback) as ComponentType<P> | null;
    if (!Comp) return null;
    return <Comp {...(rest as unknown as P)} />;
}
