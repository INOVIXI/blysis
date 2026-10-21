// @vitest-environment node
/**
 * The development Postgres and Redis answer this machine and no other.
 *
 * docker-compose.dev.yml publishes both, with a fixed password and no Redis
 * password at all, because only the developer's own processes should reach
 * them. A port written as `5432:5432` binds every interface, and on a laptop
 * on a café network that is a database anyone on the network can log in to.
 *
 * They are also the images the production stack runs. A newer Postgres
 * locally is how a query that only one version accepts gets written.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const DEV = read("docker-compose.dev.yml");
const PRODUCTION = read("docker-compose.yml");

const published = [...DEV.matchAll(/^\s*-\s*"([^"]+:\d+)"\s*$/gm)].map((m) => m[1]);
const images = (compose: string) => [...compose.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);

describe("the development services", () => {
    it("publish every port on 127.0.0.1 alone", () => {
        expect(published.length).toBe(2);
        expect(published.filter((port) => !port.startsWith("127.0.0.1:"))).toEqual([]);
    });

    it("run the images production runs", () => {
        const production = images(PRODUCTION);
        expect(images(DEV).filter((image) => !production.includes(image))).toEqual([]);
    });

    it("keep their data apart from a production stack on the same machine", () => {
        expect(DEV).toMatch(/^name:\s*blysis-dev\s*$/m);
    });

    it("are the ones the example env and the README point at", () => {
        expect(read(".env.example")).toContain('DATABASE_URL="postgresql://blysis:blysis@localhost:5432/blysis"');
        expect(JSON.parse(read("package.json")).scripts["services:up"]).toContain("docker-compose.dev.yml");
        expect(read("README.md")).toContain("npm run services:up");
    });
});
