/**
 * The route that streams uploaded files off disk.
 *
 * Next bakes `public/` into a manifest at build time, so files written after
 * the build are not served by the static handler. This route takes the
 * `/uploads/*` namespace and reads them itself, which means it turns a URL
 * into a filesystem path, and that is the shape of every directory traversal
 * there has ever been.
 *
 * It defends twice: it refuses a segment that is a dot, a double dot or that
 * carries a separator, and it then requires the resolved path to sit inside
 * the uploads directory. Neither defence had a test, and a request from
 * outside cannot reach the route to prove them, because the locale middleware
 * answers a traversal attempt with a redirect before the route is asked. So
 * the handler is called directly here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GET } from "@/app/uploads/[...path]/route";

const UPLOADS = path.resolve(process.cwd(), "public", "uploads");
// Named per process, so two runs in one checkout cannot delete each other's fixture.
const FIXTURE = `vitest-fixture-${process.pid}.txt`;
const OUTSIDE = `vitest-outside-secret-${process.pid}.txt`;
const SECRET = path.resolve(process.cwd(), OUTSIDE);

const call = (segments: string[]) =>
    GET(new Request("http://localhost/uploads"), { params: Promise.resolve({ path: segments }) });

beforeAll(async () => {
    await fs.mkdir(UPLOADS, { recursive: true });
    await fs.writeFile(path.join(UPLOADS, FIXTURE), "inside", "utf8");
    await fs.writeFile(SECRET, "outside", "utf8");
});

afterAll(async () => {
    await fs.rm(path.join(UPLOADS, FIXTURE), { force: true });
    await fs.rm(SECRET, { force: true });
});

describe("an upload url", () => {
    it("serves a file that is really inside the uploads directory", async () => {
        const res = await call([FIXTURE]);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/plain");
        // Never let a browser guess a type for bytes a stranger uploaded.
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("refuses to walk out of the directory", async () => {
        // Params arrive decoded, so this is what a %2e%2e attempt looks like
        // by the time the handler sees it.
        //
        // The guarantee is that the bytes never leave, not which refusal is
        // used to say so: the segment check answers 400 and the resolved-path
        // check answers 403, and either is a pass. Asserting one status would
        // turn the second defence into a failure.
        for (const attempt of [
            ["..", "..", OUTSIDE],
            ["..", OUTSIDE],
            [".", "..", OUTSIDE],
        ]) {
            const res = await call(attempt);
            expect(res.status, attempt.join("/")).toBeGreaterThanOrEqual(400);
            expect(await res.text(), `${attempt.join("/")} must not return the file`).not.toContain("outside");
        }
    });

    it("refuses a segment carrying a separator, which would smuggle a path", async () => {
        for (const attempt of [[`../${OUTSIDE}`], ["sub/dir"], ["back\\slash"]]) {
            const res = await call(attempt);
            expect(res.status, attempt[0]).toBeGreaterThanOrEqual(400);
            expect(await res.text()).not.toContain("outside");
        }
    });

    it("refuses an empty segment", async () => {
        expect((await call([""])).status).toBe(400);
        expect((await call([])).status).toBe(404);
    });

    it("does not stream a directory", async () => {
        // `stat` succeeds on a directory; only a file may be sent.
        expect((await call(["."])).status).toBe(400);
        const res = await call(["..", "uploads"]);
        expect(res.status).toBe(400);
    });

    it("answers a missing file with not found, not with an error", async () => {
        expect((await call(["definitely-absent.png"])).status).toBe(404);
    });
});
