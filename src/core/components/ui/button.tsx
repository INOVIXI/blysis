import * as React from "react";
import { cn } from "@/core/lib/utils";

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
    size?: "default" | "sm" | "lg" | "icon";
}

/**
 * The button's own classes, without the button.
 *
 * Some controls that should look like a button have to be an anchor - a pager
 * that moves through the URL rather than through state, for one. Rather than
 * copying the class string into those, they ask for it here. `Button` itself
 * calls it too: the two used to hold separate copies of the same eleven-line
 * class string, which is two places for a colour to be changed in one.
 *
 * `gap-2` is part of the base, so a button spaces its own icon. Callers spent
 * a long time adding `mr-2` to the icon on top of that and getting sixteen
 * pixels where the next screen had eight; the margin belongs to nobody now.
 *
 * The filled variants use each colour's own `-foreground` token rather than
 * `text-white`. A theme is free to pick a pale primary, and white on pale
 * yellow is not a label anyone can read.
 */
export function buttonClassName(
    variant: ButtonProps["variant"] = "default",
    size: ButtonProps["size"] = "default",
    className?: string,
): string {
    return cn(
        // `blysis-button` styles nothing: it is the name a theme stylesheet
        // reaches a button by, since the utilities beside it change.
        "blysis-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        {
            "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm": variant === "default",
            "bg-destructive text-destructive-foreground hover:bg-destructive/90": variant === "destructive",
            "border border-border bg-card hover:bg-muted text-foreground": variant === "outline",
            "bg-secondary text-secondary-foreground hover:bg-secondary/80": variant === "secondary",
            "hover:bg-muted text-muted-foreground": variant === "ghost",
            "text-primary underline-offset-4 hover:underline": variant === "link",
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-md px-3 text-xs": size === "sm",
            "h-12 rounded-lg px-8 text-base": size === "lg",
            "h-10 w-10": size === "icon",
        },
        className,
    );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = "default", size = "default", ...props }, ref) => {
        return (
            <button
                className={buttonClassName(variant, size, className)}
                ref={ref}
                {...props}
            />
        );
    }
);
Button.displayName = "Button";

export { Button };
