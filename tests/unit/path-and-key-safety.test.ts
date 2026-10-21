/**
 * What the code scanner found, and what was actually wrong.
 *
 * GitHub's CodeQL raised forty-five alerts on this repository. Most of the
 * thirty path-injection ones were already unreachable: every install and
 * update route checks its id against `/^[a-z0-9-]+$/` before building a
 * path. But the check and the `path.join` sat two hundred lines apart, so
 * neither a reader nor an analyser could see they were connected, and an
 * edit that moved or loosened one would not have been noticed by the other.
 * `resolveWithin()` puts the containment where the path is built.
 *
 * Three alerts were genuinely wrong code:
 *
 *   - `/^[a-zA-Z][a-zA-Z0-9.-_]*$/` in the module scaffolding CLI. Inside a
 *     character class `.-_` is a range from `.` to `_`, so that pattern
 *     accepted `/`, `\`, `:`, `<`, `>`, `@`, `[` and `]` in a hook or slot
 *     name. The intent was three literal characters.
 *   - five check-then-read pairs, where `fs.access` asked whether a manifest
 *     existed and `fs.readFile` then read it, leaving a gap the file could
 *     change in. One read answers both questions.
 *
 * This gate holds each of those closed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { resolveWithin } from "@/core/lib/runtime-paths";
import { stripHtmlTags } from "@/core/lib/utils";
import { isUnsafeKey, emptyRecord } from "@/core/lib/safe-object";
import { relativePath } from "./source-text";

const ROOT = join(__dirname, "../..");
const SCANNED = ["src", "scripts", "module-sources"];

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "node_modules" || entry === "generated" || entry === "modules") continue;
            sourceFiles(full, out);
        } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
    }
    return out;
}

function scanned(): { rel: string; source: string }[] {
    const files: { rel: string; source: string }[] = [];
    for (const dir of SCANNED) {
        for (const full of sourceFiles(join(ROOT, dir))) {
            files.push({
                rel: relativePath(ROOT, full).replace(/\\/g, "/"),
                source: readFileSync(full, "utf-8"),
            });
        }
    }
    return files;
}

// The answer is a native path, because every caller hands it to `fs`. On
// Windows the root lands on the current drive with backslashes, so the
// expectation is spelled the way the platform spells it; on Linux it is
// exactly "/srv/app/modules".
const MODULES_ROOT = resolve("/srv/app/modules");

describe("resolveWithin", () => {
    it("returns a path inside the root", () => {
        expect(resolveWithin("/srv/app/modules", "blog")).toBe(join(MODULES_ROOT, "blog"));
    });

    it("refuses a segment that climbs out", () => {
        expect(resolveWithin("/srv/app/modules", "../../etc")).toBeNull();
        expect(resolveWithin("/srv/app/modules", "..")).toBeNull();
        expect(resolveWithin("/srv/app/modules", "a/../../b")).toBeNull();
    });

    it("refuses an absolute segment", () => {
        expect(resolveWithin("/srv/app/modules", "/etc/passwd")).toBeNull();
    });

    it("refuses a sibling that merely shares a prefix", () => {
        expect(resolveWithin("/srv/app/modules", "../modules-evil")).toBeNull();
    });

    it("allows the root itself", () => {
        expect(resolveWithin("/srv/app/modules", ".")).toBe(MODULES_ROOT);
    });

    it("allows a child whose name only starts with two dots", () => {
        expect(resolveWithin("/srv/app/modules", "..blog")).toBe(join(MODULES_ROOT, "..blog"));
    });

    it("allows a child of a filesystem root", () => {
        expect(resolveWithin("/", "srv")).toBe(join(resolve("/"), "srv"));
    });
});

describe("the routes that unpack an upload", () => {
    const UNPACKERS = [
        "src/app/api/v1/modules/marketplace/install/route.ts",
        "src/app/api/v1/modules/update/route.ts",
        "src/app/api/v1/themes/marketplace/install/route.ts",
    ];

    it("build their target directory with resolveWithin, never a bare join", () => {
        const offenders: string[] = [];
        for (const rel of UNPACKERS) {
            const source = readFileSync(join(ROOT, rel), "utf-8");
            for (const m of source.matchAll(/path\.join\(\s*(MODULES_DIR|THEMES_DIR|tmpDir|TMP_DIR)\s*,/g)) {
                offenders.push(`${rel}: ${m[0]}`);
            }
            if (!source.includes("resolveWithin(")) offenders.push(`${rel}: no resolveWithin call`);
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });

    it("still checks the id before it reaches a path", () => {
        for (const rel of UNPACKERS) {
            const source = readFileSync(join(ROOT, rel), "utf-8");
            expect(source, rel).toMatch(/\/\^\[a-z0-9-\]\+\$\/\.test\(/);
        }
    });

    it("asks the filesystem for the manifest once, not twice", () => {
        const offenders: string[] = [];
        for (const rel of [...UNPACKERS, "src/app/api/v1/modules/upload/route.ts", "src/app/api/v1/themes/upload/route.ts"]) {
            const source = readFileSync(join(ROOT, rel), "utf-8");
            for (const m of source.matchAll(/fs\.access\((\w*[Mm]anifest\w*)/g)) {
                offenders.push(`${rel}: fs.access(${m[1]}) before reading it`);
            }
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });
});

describe("stripHtmlTags", () => {
    it("strips a plain tag", () => {
        expect(stripHtmlTags("<p>hello</p>")).toBe("hello");
    });

    it("leaves nothing a second pass would find", () => {
        // The interleaved cases a single `replace` is usually wrong about.
        // This character class happens to be safe from them, and the loop
        // means no reader has to work out why.
        expect(stripHtmlTags("<<a>script>x")).toBe("script>x");
        expect(stripHtmlTags("<scr<a>ipt>x")).toBe("ipt>x");
        expect(stripHtmlTags("<<>>")).toBe(">");
    });

    it("is a fixed point on its own output, for any arrangement of the tricky characters", () => {
        const chars = ["<", ">", "a", "/", "!", "-", " "];
        for (let n = 0; n < 20000; n++) {
            let input = "";
            let x = n;
            for (let i = 0; i < 1 + (n % 9); i++) {
                input += chars[x % chars.length];
                x = Math.floor(x / chars.length);
            }
            const once = stripHtmlTags(input);
            expect(stripHtmlTags(once), input).toBe(once);
        }
    });

    it("is the only tag stripper in the tree", () => {
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            if (rel === "src/core/lib/utils.ts") continue;
            if (rel.startsWith("tests/")) continue;
            for (const m of source.matchAll(/\.replace\(\/<\[\^>\]\*\+?>\/g/g)) {
                offenders.push(`${rel}: ${m[0]}`);
            }
        }
        expect(offenders, `Use stripHtmlTags():\n${offenders.join("\n")}`).toEqual([]);
    });
});

describe("character classes", () => {
    it("never build a range out of punctuation", () => {
        // `[.-_]` is every code point from 0x2E to 0x5F, which is `/`, `:`,
        // `<`, `>`, `@`, `[`, `\` and `]` among others - never the intent.
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            if (rel === "tests/unit/path-and-key-safety.test.ts") continue;
            // A trailing `-` before the `]` is a literal and correct; only a
            // `-` with something after it forms a range.
            for (const m of source.matchAll(/\[[^\]\n]*\.-[^\]\n][^\]\n]*\]/g)) {
                offenders.push(`${rel}: ${m[0]}`);
            }
        }
        expect(offenders, `Write the literals as [._-]:\n${offenders.join("\n")}`).toEqual([]);
    });
});

describe("objects built from request keys", () => {
    it("names the keys that reach the prototype chain", () => {
        expect(isUnsafeKey("__proto__")).toBe(true);
        expect(isUnsafeKey("constructor")).toBe(true);
        expect(isUnsafeKey("prototype")).toBe(true);
        expect(isUnsafeKey("colors")).toBe(false);
    });

    it("hands out an accumulator with no prototype to pollute", () => {
        const record = emptyRecord<string>();
        expect(Object.getPrototypeOf(record)).toBeNull();
        record["__proto__"] = "x";
        expect(Object.getPrototypeOf(record)).toBeNull();
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.keys(record)).toEqual(["__proto__"]);
    });

    it("is what the two places that copy request keys use", () => {
        for (const rel of [
            "src/app/api/v1/themes/[id]/customization/route.ts",
            "src/core/lib/i18n/translation-service.ts",
        ]) {
            const source = readFileSync(join(ROOT, rel), "utf-8");
            expect(source, `${rel} should guard with isUnsafeKey`).toContain("isUnsafeKey");
            expect(source, `${rel} should accumulate into emptyRecord`).toContain("emptyRecord");
            expect(source, `${rel} should not keep a second copy of the key list`).not.toContain("UNSAFE_KEYS");
        }
    });
});
