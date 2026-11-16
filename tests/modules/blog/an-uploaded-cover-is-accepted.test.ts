/**
 * A cover uploaded from the article form is saved.
 *
 * On a site that keeps uploads on its own disk the upload answers
 * `/uploads/...`, and the article's schema asked for a whole URL, so the
 * save was refused with the picture already uploaded. An operator reported
 * it from a live site; the shop's product and category pictures had the
 * same rule and are held here too.
 */
import { describe, it, expect } from "vitest";
import { blogArticleSchema } from "@/modules/blog/lib/validations";
import { categorySchema, productSchema } from "@/modules/store/lib/validations";

const article = { title: "Season two", content: "The new season starts on Friday." };
const product = { name: "VIP", price: 5 };
const category = { name: "Ranks" };

describe("a picture uploaded to the site's own disk", () => {
    it("is a blog article's cover", () => {
        expect(blogArticleSchema.safeParse({ ...article, coverImage: "/uploads/2026/11/cover.png" }).success).toBe(true);
    });

    it("is a product's picture and one of its gallery", () => {
        expect(productSchema.safeParse({ ...product, image: "/uploads/vip.png", images: ["/uploads/vip-2.png"] }).success).toBe(true);
    });

    it("is a shelf's picture", () => {
        expect(categorySchema.safeParse({ ...category, image: "/uploads/ranks.png" }).success).toBe(true);
    });
});

describe("an address no page should draw", () => {
    it("is still refused everywhere a picture is kept", () => {
        for (const bad of ["javascript:alert(1)", "//evil.example/a.png", "/uploads/../../etc/passwd"]) {
            expect(blogArticleSchema.safeParse({ ...article, coverImage: bad }).success).toBe(false);
            expect(productSchema.safeParse({ ...product, image: bad }).success).toBe(false);
            expect(productSchema.safeParse({ ...product, images: [bad] }).success).toBe(false);
            expect(categorySchema.safeParse({ ...category, image: bad }).success).toBe(false);
        }
    });

    it("is not an empty cover, which is no cover", () => {
        // The article form sends "" when nothing was chosen, and `.url()`
        // refused that too, so an article without a cover was not saved.
        const parsed = blogArticleSchema.safeParse({ ...article, coverImage: "" });
        expect(parsed.success).toBe(true);
        expect(parsed.data?.coverImage).toBeNull();
    });

    it("leaves a linked picture as it was", () => {
        expect(blogArticleSchema.safeParse({ ...article, coverImage: "https://cdn.example.com/a.png" }).success).toBe(true);
        expect(blogArticleSchema.safeParse({ ...article, coverImage: null }).success).toBe(true);
    });
});
