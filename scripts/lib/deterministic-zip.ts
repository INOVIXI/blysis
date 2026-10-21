/**
 * A ZIP whose bytes are a function of its contents and nothing else.
 *
 * `zip -r` stored each file's mtime and atime, so the bytes of a published
 * archive depended on when someone last read the file rather than on what it
 * said: a rebuild after merely opening a module.json produced a different
 * artifact, and a fresh clone, where every mtime is checkout time, could not
 * reproduce any of them. Traversal order came from readdir, which is not
 * stable either.
 *
 * So every entry carries the ZIP epoch (1980-01-01 00:00), mode 0644 from a
 * Unix creator, no extra fields and no data descriptor, in the order the
 * caller sorted them. The layout is the one Python's zipfile wrote when this
 * was a Python step, field for field.
 */
import zlib from "node:zlib";

export interface ZipEntry {
    /** Forward-slash path inside the archive. */
    name: string;
    data: Buffer;
}

const VERSION = 20;
const MADE_BY = (3 << 8) | VERSION;
const DEFLATE = 8;
const UTF8_NAME = 0x800;
const EPOCH_TIME = 0;
const EPOCH_DATE = (0 << 9) | (1 << 5) | 1;
const MODE_0644 = 0o644 << 16;

export function deterministicZip(entries: ZipEntry[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const name = Buffer.from(entry.name, "utf8");
        const flags = /^[\x20-\x7e]*$/.test(entry.name) ? 0 : UTF8_NAME;
        const packed = zlib.deflateRawSync(entry.data, { level: 9 });
        const crc = zlib.crc32(entry.data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(VERSION, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(DEFLATE, 8);
        local.writeUInt16LE(EPOCH_TIME, 10);
        local.writeUInt16LE(EPOCH_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(MADE_BY, 4);
        central.writeUInt16LE(VERSION, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(DEFLATE, 10);
        central.writeUInt16LE(EPOCH_TIME, 12);
        central.writeUInt16LE(EPOCH_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(MODE_0644 >>> 0, 38);
        central.writeUInt32LE(offset, 42);

        locals.push(local, name, packed);
        centrals.push(central, name);
        offset += local.length + name.length + packed.length;
    }

    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, directory, end]);
}
