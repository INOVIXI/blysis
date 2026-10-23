"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { User, LogOut, Shield, Sun, Moon } from "lucide-react";
import { Link } from "@/core/lib/i18n/navigation";
import { buttonClassName } from "@/core/components/ui/button";
import { MemberAvatar } from "@/core/components/ui/MemberAvatar";
import { useDarkMode } from "@/core/hooks/useDarkMode";
import { useAllModules } from "@/core/providers/module-provider";
import { ModuleNavbarComponents } from "@/core/generated/module-registry";
import { NavbarComponentRegistry } from "@/core/generated/module-components";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { Slot } from "@/core/components/Slot";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { STAFF_ROLE_PRIORITY } from "@/core/lib/constants";

/**
 * The controls at the end of the site's bar: the mode toggle, what modules
 * put there (the cart, the bell), and the account menu or the way to sign in.
 *
 * Its own component so a theme that draws its navigation somewhere else can
 * still put these where its design wants them, and get every module's
 * control and the staff link with them rather than a copy that misses one.
 */
export function NavbarActions() {
    const t = useTranslations("nav");
    const commonT = useTranslations("common");
    const { data: session } = useSession();
    const moduleStatus = useAllModules();
    const [menuOpen, setMenuOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const { isDark, toggle: toggleDarkMode, locked: modeLocked } = useDarkMode();
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Navbar components from modules (bell, cart, etc.)
    const enabledNavbarComponents = ModuleNavbarComponents
        .filter(nc => isEnabledIn(moduleStatus, nc.module))
        .filter(nc => NavbarComponentRegistry[nc.id]);

    const isStaffUser = (session?.user?.rolePriority ?? 0) >= STAFF_ROLE_PRIORITY;

    return (
        <div className="flex items-center gap-2">
            {/* The button holds its place before the theme is
                known. Rendering nothing until `mounted` left a
                gap that filled after paint and pushed this whole
                row sideways, which is a layout shift for the sake
                of one icon. Only the icon waits now.

                It is not disabled while it waits. `disabled` is
                an attribute, so marking it made the served HTML
                differ from what the same component asks for once
                it has mounted, and React reported the pair as a
                hydration mismatch it would not patch up. It was
                buying nothing either way: a button that has not
                hydrated has no handler to run. */}
            {/* A site that holds its mode has nothing to offer here.
                The lock is known on the server, so the button is
                absent from the first paint, not removed after it. */}
            {!modeLocked && (
                <button onClick={toggleDarkMode}
                    aria-label={isDark ? t('switchToLight') : t('switchToDark')}
                    className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    {mounted
                        ? (isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />)
                        : <span className="block w-4 h-4" aria-hidden="true" />}
                </button>
            )}

            {session?.user ? (
                <>
                    {/* Module navbar components (bell, cart, etc.) - from registry */}
                    {enabledNavbarComponents.map(nc => {
                        const NavComp = NavbarComponentRegistry[nc.id];
                        return (
                            <ModuleErrorBoundary key={nc.id} componentId={nc.id}>
                                <NavComp />
                            </ModuleErrorBoundary>
                        );
                    })}

                    <Slot name="navbar.end" />

                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            onClick={() => setMenuOpen(!menuOpen)}
                            aria-label={t('profileMenu')}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors">
                            <MemberAvatar name={session.user.name || "?"} src={session.user.image} size={28} />
                            <span className="text-sm font-medium text-foreground hidden sm:block">{session.user.name}</span>
                        </button>

                        {menuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-48 bg-card rounded-lg shadow-lg border border-border py-1 z-50 animate-fade-in">
                                <div className="px-3 py-2 border-b border-border">
                                    <p className="text-sm font-medium text-foreground truncate">{session.user.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                                </div>
                                <Link href="/profile" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setMenuOpen(false)}>
                                    <User className="w-4 h-4" /> {t('profile')}
                                </Link>
                                {isStaffUser && (
                                    <Link href="/admin" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setMenuOpen(false)}>
                                        <Shield className="w-4 h-4" /> {t('adminPanel')}
                                    </Link>
                                )}
                                <div className="border-t border-border">
                                    <button onClick={() => signOut({ callbackUrl: "/" })} className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 w-full text-left">
                                        <LogOut className="w-4 h-4" /> {commonT('logout')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex items-center gap-2">
                    <Link href="/auth/login" className={buttonClassName("ghost", "sm", "text-muted-foreground")}>{commonT('login')}</Link>
                    <Link href="/auth/register" className={buttonClassName("default", "sm")}>{commonT('register')}</Link>
                </div>
            )}
        </div>
    );
}
