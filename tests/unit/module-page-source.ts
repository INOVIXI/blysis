/**
 * What a module's page is made of, for the gates that read it as text.
 *
 * A page that reads its subject on the server is a short file: it calls one
 * `lib/read-*.ts` and renders one component, and the screen a visitor argues
 * with lives in `components/`. Gates written when those pages were one file
 * looked for their guarantee in `pages/public/page.tsx` and stopped finding
 * it the day the fetch moved to the server - not because the guarantee was
 * gone, but because it had moved one import along.
 *
 * So a gate reads the page *and* the module-local files it imports. That
 * keeps the rule about the guarantee rather than about the file it happened
 * to live in, and it is why none of those gates needed an exemption.
 */
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/** Re-exported so the gates that follow a page keep one import. */
export { stripComments };

/**
 * The file, plus every module-local file it imports, one level deep.
 *
 * One level is deliberate. It reaches the screen and the read a page hands
 * its work to, and it stops before the module's whole source becomes the
 * haystack, which would let a gate pass on a mention anywhere in the module.
 */
export function pageSource(file: string, moduleRoot: string): string {
    const own = fs.readFileSync(file, "utf8");
    let out = own;
    for (const [, relative] of own.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const target = path.resolve(path.dirname(file), relative);
        if (!target.startsWith(moduleRoot)) continue;
        for (const extension of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
            if (fs.existsSync(target + extension)) {
                out += fs.readFileSync(target + extension, "utf8");
                break;
            }
        }
    }
    return out;
}
