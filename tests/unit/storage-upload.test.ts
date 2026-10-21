import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join, sep } from "path";

/**
 * `uploadFile` is the single funnel every upload passes through - the admin
 * media library, theme archives, module ZIPs. It is the only place that
 * refuses a `.exe` renamed to `image/png`, caps decompression bombs, and
 * scrubs `<script>` out of an SVG before anyone serves the bytes back to a
 * browser. `sanitizeFilename` already had tests; the funnel did not.
 *
 * Only `fs/promises` is stubbed. The sniffer, the dimension reader and the
 * SVG sanitiser all run for real, because agreeing with a mock of them
 * would prove nothing about what actually reaches disk.
 */

const { mkdir, writeFile } = vi.hoisted(() => ({
    mkdir: vi.fn(async (_dir: string, _opts?: { recursive?: boolean }) => undefined),
    writeFile: vi.fn(async (_file: string, _data: Buffer) => undefined),
}));

vi.mock("fs/promises", () => ({
    default: { mkdir, writeFile },
    mkdir,
    writeFile,
}));

let settingRow: unknown;
let settingThrows: unknown = null;

vi.mock("@/core/lib/db", () => ({
    prisma: {
        setting: {
            findUnique: async () => {
                if (settingThrows) throw settingThrows;
                return settingRow;
            },
        },
    },
}));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));

vi.mock("@/core/lib/logger", () => ({
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    log: { debug: vi.fn(), info: vi.fn(), warn: logWarn, error: vi.fn() },
}));

let registry: Record<string, () => Promise<unknown>>;
let registryImportThrows = false;

vi.mock("@/core/generated/module-storage", () => {
    if (registryImportThrows) throw new Error("module-storage was removed by an uninstall");
    return { get StorageProviderRegistry() { return registry; } };
});

// --- fixtures ------------------------------------------------------------

/** A PNG whose IHDR declares the given dimensions. */
function png(width = 64, height = 64): Buffer {
    const buf = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
}

function gif(width = 10, height = 10): Buffer {
    const buf = Buffer.alloc(16);
    Buffer.from("GIF89a").copy(buf, 0);
    buf.writeUInt16LE(width, 6);
    buf.writeUInt16LE(height, 8);
    return buf;
}

/** A JPEG with an APP0 segment followed by a real SOF0 frame header. */
function jpeg(width = 64, height = 64): Buffer {
    const buf = Buffer.alloc(64);
    buf.writeUInt16BE(0xffd8, 0);   // SOI
    buf.writeUInt16BE(0xffe0, 2);   // APP0
    buf.writeUInt16BE(16, 4);       // segment length, payload follows
    buf.write("JFIF\0", 6, "ascii");
    buf.writeUInt16BE(0xffc0, 20);  // SOF0
    buf.writeUInt16BE(17, 22);      // segment length
    buf.writeUInt8(8, 24);          // sample precision
    buf.writeUInt16BE(height, 25);
    buf.writeUInt16BE(width, 27);
    return buf;
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n");
const JSON_BYTES = Buffer.from('{"hello":"world"}');

beforeEach(() => {
    mkdir.mockClear();
    writeFile.mockClear();
    settingRow = null;
    settingThrows = null;
    registry = {};
    registryImportThrows = false;
    vi.stubEnv("STORAGE_PROVIDER", undefined);
    vi.resetModules();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

async function load() {
    return import("@/core/lib/storage");
}

describe("uploadFile: input validation", () => {
    it("rejects a missing filename", async () => {
        const { uploadFile } = await load();
        await expect(uploadFile(png(), "", "image/png")).rejects.toThrow("Invalid filename");
        await expect(uploadFile(png(), null as never, "image/png")).rejects.toThrow("Invalid filename");
    });

    it("rejects a file over the 50 MB cap", async () => {
        const { uploadFile, UPLOAD_MAX_SIZE } = await load();
        const huge = Buffer.alloc(UPLOAD_MAX_SIZE + 1);
        png().copy(huge, 0);

        await expect(uploadFile(huge, "big.png", "image/png")).rejects.toThrow("File too large");
        // Rejected before the sniffer touches 50 MB of bytes.
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("rejects a MIME type outside the allowlist", async () => {
        const { uploadFile } = await load();
        await expect(uploadFile(png(), "x.html", "text/html")).rejects.toThrow("Invalid file type");
    });
});

describe("uploadFile: content sniffing", () => {
    it("rejects an executable renamed to a png", async () => {
        const { uploadFile } = await load();
        const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04]);

        // The whole reason the sniffer exists: the claimed header is a hint.
        await expect(uploadFile(exe, "innocent.png", "image/png")).rejects.toThrow("Invalid file type");
    });

    it("rejects bytes that are allowed but disagree with the claim", async () => {
        const { uploadFile } = await load();
        await expect(uploadFile(PDF, "doc.png", "image/png")).rejects.toThrow("Invalid file type");
    });

    it("treats image/jpg as image/jpeg", async () => {
        const { uploadFile } = await load();
        // A common client typo, not an attack - rejecting it breaks uploads
        // from real browsers.
        await expect(uploadFile(jpeg(), "photo.jpg", "image/jpg")).resolves.toMatchObject({
            url: expect.stringContaining("/uploads/"),
        });
    });

    it("trusts a text/plain claim, which has no magic bytes to sniff", async () => {
        const { uploadFile } = await load();
        const result = await uploadFile(JSON_BYTES, "notes.txt", "text/plain");

        expect(result.path).toContain("public/uploads/");
    });

    it("normalises the stored MIME to the sniffed one, not the claim", async () => {
        const upload = vi.fn(async () => ({ url: "/x", path: "x" }));
        registry = { s3: async () => ({ upload }) };
        settingRow = { value: "s3" };
        const { uploadFile } = await load();

        await uploadFile(JSON_BYTES, "notes.txt", "text/plain");

        // The provider must be told what the bytes are, not what the client
        // said they were.
        expect(upload).toHaveBeenCalledWith(JSON_BYTES, "notes.txt", "application/json");
    });
});

describe("uploadFile: decompression bombs", () => {
    it("rejects a raster image past the dimension cap", async () => {
        const { uploadFile } = await load();
        // ~4 MB on disk, ~1.5 GB of RGBA once anything decodes it.
        await expect(uploadFile(png(20000, 20000), "bomb.png", "image/png"))
            .rejects.toThrow("File too large");
    });

    it("rejects a zero-dimension image", async () => {
        const { uploadFile } = await load();
        await expect(uploadFile(png(0, 100), "flat.png", "image/png"))
            .rejects.toThrow("File too large");
    });

    it("accepts an image exactly at the cap", async () => {
        const { uploadFile } = await load();
        const { MAX_IMAGE_DIMENSION } = await import("@/core/lib/file-type-detection");

        await expect(
            uploadFile(png(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), "big.png", "image/png"),
        ).resolves.toBeTruthy();
    });

    it("rejects a raster image whose header is too short to measure", async () => {
        const { uploadFile } = await load();
        const truncated = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

        // An unmeasurable image is not a safe image.
        await expect(uploadFile(truncated, "short.png", "image/png"))
            .rejects.toThrow("Invalid file type");
    });

    it("checks GIF dimensions too, not just PNG", async () => {
        const { uploadFile } = await load();
        await expect(uploadFile(gif(9000, 10), "wide.gif", "image/gif"))
            .rejects.toThrow("File too large");
        await expect(uploadFile(gif(10, 10), "ok.gif", "image/gif")).resolves.toBeTruthy();
    });

    it("does not dimension-check a PDF", async () => {
        const { uploadFile } = await load();
        await expect(uploadFile(PDF, "doc.pdf", "application/pdf")).resolves.toBeTruthy();
    });
});

describe("uploadFile: SVG sanitisation", () => {
    it("strips script out of an SVG before it reaches the provider", async () => {
        const upload = vi.fn(async () => ({ url: "/x", path: "x" }));
        registry = { s3: async () => ({ upload }) };
        settingRow = { value: "s3" };
        const { uploadFile } = await load();

        const hostile = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>'
            + '<a href="javascript:alert(2)" onload="alert(3)"/></svg>',
        );
        await uploadFile(hostile, "logo.svg", "image/svg+xml");

        const stored = (upload.mock.calls[0] as unknown as [Buffer])[0].toString();
        expect(stored).not.toContain("<script");
        expect(stored).not.toContain("onload");
        expect(stored).not.toContain("javascript:");
        // The original buffer must not be what gets persisted.
        expect(stored).not.toBe(hostile.toString());
    });

    it("leaves non-SVG bytes untouched", async () => {
        const upload = vi.fn(async () => ({ url: "/x", path: "x" }));
        registry = { s3: async () => ({ upload }) };
        settingRow = { value: "s3" };
        const { uploadFile } = await load();
        const bytes = png();

        await uploadFile(bytes, "a.png", "image/png");

        expect((upload.mock.calls[0] as unknown as [Buffer])[0]).toBe(bytes);
    });
});

// What reaches `fs` is a native path, so on Windows its separators are
// backslashes. The `url` and `path` the provider returns are not filesystem
// paths but the public address and the stored key, and stay forward slashes.
const UPLOADS_DIR = join("public", "uploads");

describe("localStorageProvider", () => {
    it("writes under public/uploads with a uuid-prefixed sanitised name", async () => {
        const { localStorageProvider } = await load();

        const result = await localStorageProvider.upload(png(), "my photo!.png", "image/png");

        expect(mkdir).toHaveBeenCalledWith(expect.stringContaining(UPLOADS_DIR), { recursive: true });
        expect(result.url).toMatch(/^\/uploads\/[0-9a-f-]{36}-my-photo-\.png$/);
        expect(result.path).toBe(`public${result.url}`);
        // Two uploads of the same name must not overwrite each other.
        const second = await localStorageProvider.upload(png(), "my photo!.png", "image/png");
        expect(second.url).not.toBe(result.url);
    });

    it("keeps a traversal attempt inside the uploads directory", async () => {
        const { localStorageProvider } = await load();

        const result = await localStorageProvider.upload(png(), "../../etc/passwd", "text/plain");

        expect(result.path.startsWith("public/uploads/")).toBe(true);
        const written = writeFile.mock.calls[0][0];
        expect(written).toContain(UPLOADS_DIR + sep);
        expect(written).not.toContain("..");
    });
});

describe("storage provider resolution", () => {
    async function uploadOnce() {
        const { uploadFile } = await load();
        return uploadFile(png(), "a.png", "image/png");
    }

    it("uses the admin setting when it holds a plain id", async () => {
        const upload = vi.fn(async () => ({ url: "/s3/a.png", path: "s3/a.png" }));
        registry = { s3: async () => ({ upload }) };
        settingRow = { value: "s3" };

        expect(await uploadOnce()).toEqual({ url: "/s3/a.png", path: "s3/a.png" });
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("uses the admin setting when it holds a JSON object", async () => {
        const upload = vi.fn(async () => ({ url: "/r2/a.png", path: "r2/a.png" }));
        registry = { r2: async () => ({ upload }) };
        settingRow = { value: { id: "r2" } };

        expect(await uploadOnce()).toEqual({ url: "/r2/a.png", path: "r2/a.png" });
    });

    it("falls back to STORAGE_PROVIDER when no setting is stored", async () => {
        const upload = vi.fn(async () => ({ url: "/b2/a.png", path: "b2/a.png" }));
        registry = { b2: async () => ({ upload }) };
        vi.stubEnv("STORAGE_PROVIDER", "b2");

        expect(await uploadOnce()).toEqual({ url: "/b2/a.png", path: "b2/a.png" });
    });

    it("prefers the admin setting over the env var", async () => {
        const fromSetting = vi.fn(async () => ({ url: "/setting", path: "setting" }));
        const fromEnv = vi.fn(async () => ({ url: "/env", path: "env" }));
        registry = { s3: async () => ({ upload: fromSetting }), b2: async () => ({ upload: fromEnv }) };
        settingRow = { value: "s3" };
        vi.stubEnv("STORAGE_PROVIDER", "b2");

        // The admin UI has to win, or changing the provider in the panel
        // silently does nothing on a host that sets the env var.
        expect(await uploadOnce()).toEqual({ url: "/setting", path: "setting" });
        expect(fromEnv).not.toHaveBeenCalled();
    });

    it("uses the local filesystem when nothing is configured", async () => {
        expect(await uploadOnce()).toMatchObject({ path: expect.stringContaining("public/uploads/") });
        expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it("treats the id 'local' as the built-in provider", async () => {
        settingRow = { value: "local" };
        await uploadOnce();
        expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it("falls back to local when the configured provider is not installed", async () => {
        settingRow = { value: "s3" };
        registry = {};

        // Uninstalling the S3 module must not make every upload fail.
        expect(await uploadOnce()).toMatchObject({ path: expect.stringContaining("public/uploads/") });
    });

    it("falls back to local when the provider loader returns nothing", async () => {
        settingRow = { value: "s3" };
        registry = { s3: async () => null as never };

        expect(await uploadOnce()).toMatchObject({ path: expect.stringContaining("public/uploads/") });
    });

    it("falls back to local when the generated registry cannot be imported", async () => {
        settingRow = { value: "s3" };
        registryImportThrows = true;

        // An uninstall regenerates this file; an upload landing mid-write
        // must degrade to local rather than 500.
        expect(await uploadOnce()).toMatchObject({ path: expect.stringContaining("public/uploads/") });
    });

    it("falls back to local when the provider loader throws", async () => {
        settingRow = { value: "s3" };
        registry = { s3: async () => { throw new Error("credentials missing"); } };

        expect(await uploadOnce()).toMatchObject({ path: expect.stringContaining("public/uploads/") });
    });

    it("falls back to the env var when the settings lookup fails", async () => {
        settingThrows = new Error("relation \"Setting\" does not exist");
        const upload = vi.fn(async () => ({ url: "/b2/a.png", path: "b2/a.png" }));
        registry = { b2: async () => ({ upload }) };
        vi.stubEnv("STORAGE_PROVIDER", "b2");

        // Uploads have to keep working before the first migration has run.
        expect(await uploadOnce()).toEqual({ url: "/b2/a.png", path: "b2/a.png" });
    });

    it("ignores a setting whose value is neither a string nor an object", async () => {
        settingRow = { value: 42 };

        expect(await uploadOnce()).toMatchObject({ path: expect.stringContaining("public/uploads/") });
    });
});

/**
 * The provider that was configured and is no longer there.
 *
 * `resolveActiveProvider` falls back to the local filesystem three ways: the
 * setting cannot be read, the configured id is not in the registry, or the
 * module fails to load. All three were silent, and the fallback itself is
 * right - an upload must not fail because a module was switched off.
 *
 * What was missing is the sentence. An operator who set up R2 months ago and
 * has since disabled the module keeps uploading, and the files land on local
 * disk instead: half the media library in a bucket, half beside the app, and
 * nothing anywhere saying when the split began. It is the shape of the backup
 * job that reported ok while never once producing a backup.
 */
describe("falling back to local storage", () => {
    async function uploadOnce() {
        const { uploadFile } = await load();
        return uploadFile(png(), "a.png", "image/png");
    }

    beforeEach(() => {
        logWarn.mockClear();
    });

    it("says so when the configured provider is not registered", async () => {
        registry = {};
        settingRow = { value: "cloudflare-r2" };

        await uploadOnce();

        expect(logWarn).toHaveBeenCalled();
        const [message, meta] = logWarn.mock.calls[0] as [string, Record<string, unknown>];
        expect(`${message} ${JSON.stringify(meta ?? {})}`).toContain("cloudflare-r2");
    });

    it("says so when the module cannot be loaded at all", async () => {
        registryImportThrows = true;
        settingRow = { value: "cloudflare-r2" };

        await uploadOnce();

        expect(logWarn, "an uninstall that takes the registry with it is the loudest case").toHaveBeenCalled();
    });

    it("says nothing when local is what was asked for", async () => {
        registry = {};
        settingRow = null;

        await uploadOnce();

        expect(logWarn, "the default is not a fallback").not.toHaveBeenCalled();
    });
});
