"use client";

import { useTranslations } from "next-intl";
import { NativeSelect } from "@/core/sdk/ui";
import {
    FooterCredit,
    FooterLink,
    FooterModuleControls,
    SiteMark,
    useDarkMode,
    useFooter,
    useLanguageChoice,
    type FooterProps,
} from "@/core/sdk/theme";

const SOCIAL_NAMES = { facebook: "Facebook", instagram: "Instagram", x: "X", youtube: "YouTube" } as const;

/**
 * The night sky at the foot of the day: the site's name and what it is on the
 * left, the operator's columns beside it, and on the line under them the
 * copyright, the language and the switch between day and night, as Kite's
 * approved design drew it.
 *
 * Every part is core's, so nothing an operator or a module puts in a footer
 * is lost here: the columns with the modules' links placed, what modules
 * give a visitor to set, the slot they draw into, and the credit.
 */
export default function Footer({ top }: FooterProps) {
    const t = useTranslations("kite");
    const common = useTranslations("common");
    const nav = useTranslations("nav");
    const footer = useFooter();
    const language = useLanguageChoice();
    const mode = useDarkMode();

    return (
        <footer className="kt-foot">
            <div className="kt-foot-in container mx-auto px-4">
                {top}
                <div className="kt-foot-top">
                    <div className="kt-foot-brand">
                        <p className="kt-foot-name">
                            <SiteMark size={44} />
                            <span>{footer.siteName}</span>
                        </p>
                        {footer.about ? <p className="kt-foot-about">{footer.about}</p> : null}
                        {footer.email ? <a className="kt-foot-mail" href={`mailto:${footer.email}`}>{footer.email}</a> : null}
                        {footer.social.length > 0 ? (
                            <ul className="kt-foot-social" aria-label={nav("social")}>
                                {footer.social.map((link) => (
                                    <li key={link.name}>
                                        <a href={link.href} target="_blank" rel="noopener noreferrer">
                                            {link.name === "community" ? nav("community") : SOCIAL_NAMES[link.name]}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                    {footer.columns.map((column, index) => (
                        <nav key={`${column.title}-${index}`} aria-label={column.title} className="kt-foot-col">
                            <h2>{column.title}</h2>
                            <ul>
                                {column.links.map((link) => (
                                    <li key={link.href}><FooterLink link={link} /></li>
                                ))}
                            </ul>
                        </nav>
                    ))}
                </div>
                <div className="kt-foot-bottom">
                    <div className="kt-foot-legal">
                        <p>{footer.copyright ?? `© ${new Date().getFullYear()} ${footer.siteName}`}</p>
                        <FooterCredit className="kt-foot-credit" />
                    </div>
                    <div className="kt-foot-controls">
                        <label className="kt-foot-lang">
                            <span>{common("language")}</span>
                            <NativeSelect value={language.locale} onChange={(event) => language.choose(event.target.value)}>
                                {language.options.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </NativeSelect>
                        </label>
                        <FooterModuleControls />
                        {/* A site that holds its mode has nothing to offer here. */}
                        {mode.locked ? null : (
                            <div role="group" aria-label={t("footerLook")} className="kt-foot-mode">
                                <button type="button" aria-pressed={!mode.isDark} onClick={() => { if (mode.isDark) mode.toggle(); }}>
                                    {t("footerDay")}
                                </button>
                                <button type="button" aria-pressed={mode.isDark} onClick={() => { if (!mode.isDark) mode.toggle(); }}>
                                    {t("footerNight")}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </footer>
    );
}
