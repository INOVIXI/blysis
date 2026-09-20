import fs from "node:fs";
import { getBackupPath, listBackups, log, readSettingValues } from "@/core/sdk/server";

/**
 * Keep a copy of every database backup in the bucket.
 *
 * A backup that only exists on the machine it was taken on is not a backup.
 * Core takes the dump and knows nothing about any destination; this module
 * has the credentials and the vendor, so the copying is its job.
 *
 * Why a job rather than a reaction to a backup being taken: `doActionAsync`
 * races every listener against a five second timeout, which the upload of a
 * real dump cannot meet, so a listener would be reported as failed on every
 * successful backup. A job has no deadline to miss, and a dump that could not
 * be sent is sent on the next tick without anybody writing a retry.
 *
 * Why the bucket is asked what it already holds, rather than this module
 * keeping a list: a list is a second thing to keep true, and it is wrong the
 * first time somebody deletes an object by hand. The bucket's own answer
 * cannot drift. A list that fails sends nothing rather than everything: the
 * alternative is re-uploading the whole history every hour.
 *
 * This is deliberately not the storage provider beside it. That one answers
 * with a public URL under `publicUrl`, and a database dump behind a public
 * address is the whole site readable by whoever guesses the key.
 */

interface BackupConfig {
    accountId: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    keepBackups: boolean;
    prefix: string;
}

/** Never the root of a bucket that also holds public uploads. */
const DEFAULT_PREFIX = "backups";

function cleanPrefix(raw: unknown): string {
    if (typeof raw !== "string") return DEFAULT_PREFIX;
    const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
    return trimmed === "" ? DEFAULT_PREFIX : trimmed;
}

async function loadConfig(): Promise<BackupConfig | null> {
    // Through the SDK rather than off the row: `secretKey` is a declared
    // credential, sealed at rest, and signing with the ciphertext fails in a
    // way that reads as a bad key rather than a bad read.
    const values = await readSettingValues(["cloudflare_r2_config"]);
    const stored = values.cloudflare_r2_config;
    if (!stored || typeof stored !== "object") return null;
    const v = stored as Record<string, unknown>;
    if (v.keepBackups !== true) return null;
    if (!v.accountId || !v.bucket || !v.accessKey || !v.secretKey) return null;
    return {
        accountId: String(v.accountId),
        bucket: String(v.bucket),
        accessKey: String(v.accessKey),
        secretKey: String(v.secretKey),
        keepBackups: true,
        prefix: cleanPrefix(v.backupPrefix),
    };
}

export default async function copyBackupsToBucket(): Promise<void> {
    const config = await loadConfig();
    if (!config) return;

    const here = await listBackups();
    if (here.length === 0) return;

    // Imported here rather than at the top: this runs on a schedule, and the
    // S3 client is a large tree to pull into a graph that mostly does not
    // need it. The provider beside this file reaches the same package through
    // a `require` trick from before it was a real dependency.
    const { S3Client, PutObjectCommand, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
        forcePathStyle: false,
    });

    let already: Set<string>;
    try {
        const answer = (await client.send(
            new ListObjectsV2Command({ Bucket: config.bucket, Prefix: `${config.prefix}/` }),
        )) as { Contents?: { Key?: string }[] };
        already = new Set((answer.Contents ?? []).map((one) => one.Key ?? ""));
    } catch (err) {
        log.warn("[cloudflare-r2] could not read what the bucket already holds", {
            error: err instanceof Error ? err.message : String(err),
        });
        return;
    }

    let copied = 0;
    for (const backup of here) {
        const key = `${config.prefix}/${backup.filename}`;
        if (already.has(key)) continue;

        // Null when the file has gone since the list was read - rotation
        // runs between ticks - which is a file to skip, not to report.
        const path = await getBackupPath(backup.id);
        if (!path) continue;

        try {
            // A stream with its length, not a buffer: a dump is as large as
            // the database and reading one into memory to send it is how a
            // backup takes the site down.
            await client.send(new PutObjectCommand({
                Bucket: config.bucket,
                Key: key,
                Body: fs.createReadStream(path),
                ContentLength: fs.statSync(path).size,
                ContentType: "application/gzip",
            }));
            copied += 1;
        } catch (err) {
            // Reported and left for the next tick. One unsendable file must
            // not stop the ones behind it.
            log.warn("[cloudflare-r2] a backup could not be copied to the bucket", {
                filename: backup.filename,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    if (copied > 0) {
        log.info("cron: backups copied to the bucket", { job: "cloudflare-r2:copy-backups", copied });
    }
}
