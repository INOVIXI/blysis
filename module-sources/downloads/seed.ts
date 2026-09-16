import type { ModuleSeed } from "@/core/sdk/seed";
import { downloadSlug } from "./lib/guide";

interface File {
    title: string;
    description: string;
    fileName: string;
    fileSize: number;
    /**
     * True for the files that need explaining before they are any use.
     *
     * Not all of them, because the list has to show both states: a row whose
     * title is a link and a row whose title is not. The rules PDF needs no
     * tutorial, and a demo where every row links looks like a design that
     * never met the common case.
     */
    guide?: true;
}

/** The files a community actually hands out, with plausible sizes. */
const FILES: File[] = [
    { guide: true, title: "Modpack (client)", description: "Everything you need to join, in one folder.", fileName: "server-modpack-1.8.0.zip", fileSize: 384_000_000 },
    { title: "Resource pack", description: "Our textures. Optional but recommended.", fileName: "resource-pack-v9.zip", fileSize: 46_000_000 },
    { title: "Map: last season's world", description: "The survival world as it was at the end of season 3.", fileName: "season-3-world.zip", fileSize: 1_900_000_000 },
    { guide: true, title: "Launcher", description: "Starts the game with the right settings.", fileName: "launcher-setup.exe", fileSize: 62_000_000 },
    { title: "Schematics pack", description: "Build templates from the contest winners.", fileName: "schematics.zip", fileSize: 12_400_000 },
    { title: "Server rules (PDF)", description: "The rules, in one page.", fileName: "rules.pdf", fileSize: 240_000 },
];

/** The same covers the rest of the demo uses: shipped, small, no network. */
const COVERS = ["/demo/cover-guide.svg", "/demo/cover-notice.svg"];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        for (const { title, description, fileName, fileSize, guide } of FILES) {
            const existing = await ctx.prisma.download.findFirst({ where: { fileName } });
            if (existing) continue;
            await ctx.create("download", () => ctx.prisma.download.create({
                data: {
                    title,
                    slug: downloadSlug(title),
                    description,
                    details: guide ? ctx.paragraphs(ctx.int(5, 9)) : null,
                    coverImage: guide ? ctx.pick(COVERS) : null,
                    fileName,
                    fileUrl: `https://cdn.example.invalid/${fileName}`,
                    fileSize,
                    downloads: ctx.int(20, 9000),
                    createdAt: ctx.daysAgo(300),
                },
            }));
        }
        ctx.log(`${FILES.length} downloads`);
    },
};
