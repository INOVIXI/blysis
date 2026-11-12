import { KeyRound } from "lucide-react";
import { ModuleOauthButtons } from "@/core/generated/module-registry";

/**
 * What a provider is called and how it looks, from the button its module
 * declared for the sign-in page. Core names no provider, so this is the only
 * place a name and a mark can come from; a provider whose module has since
 * been removed falls back to its id and a plain key.
 */
export function providerButton(provider: string) {
    return ModuleOauthButtons.find((button) => button.provider === provider) ?? null;
}

export function providerLabel(provider: string): string {
    return providerButton(provider)?.label ?? provider;
}

interface ProviderMarkProps {
    provider: string;
    className?: string;
}

export function ProviderMark({ provider, className = "w-5 h-5" }: ProviderMarkProps) {
    const button = providerButton(provider);
    if (!button) return <KeyRound className={`${className} text-muted-foreground`} aria-hidden="true" />;
    return (
        <svg className={className} viewBox="0 0 24 24" fill={button.color} aria-hidden="true">
            {button.svgIcon.split("|").map((d, i) => <path key={i} d={d} />)}
        </svg>
    );
}
