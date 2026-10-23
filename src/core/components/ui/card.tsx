import * as React from "react";
import { cn } from "@/core/lib/utils";

const Card = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("blysis-card rounded-xl bg-card text-card-foreground border border-border shadow-sm", className)} {...props} />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

/**
 * Heading rank is document structure, not font size.
 *
 * A card title used to be a hardcoded `<h3>`. Cards sit directly under a
 * page's `<h1>` almost everywhere in this product, so every one of them made
 * the page skip from h1 to h3 - the single most common accessibility defect
 * in the tree. The rank now defaults to `h2`, the correct rank for a section
 * that is a direct child of the page title, and `as` lets a card nested
 * inside an `h2` section drop to `h3` where that is the true structure.
 *
 * Pass `as="div"` for a card whose title is decorative and names no region.
 */
type CardTitleTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div";

const CardTitle = React.forwardRef<
    HTMLHeadingElement,
    React.HTMLAttributes<HTMLHeadingElement> & { as?: CardTitleTag }
>(({ className, as, ...props }, ref) => {
    const Tag = (as ?? "h2") as CardTitleTag;
    return <Tag ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
});
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
