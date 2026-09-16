import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { rateLimit } from "@/core/lib/rate-limit";
import { uploadFile } from "@/core/lib/storage";
import { prisma } from "@/core/lib/db";
import { log } from "@/core/lib/logger";
import { readSettingValues } from "@/core/lib/setting-values";
import { MEMBER_AVATAR_UPLOADS_KEY, memberAvatarUploads } from "@/core/lib/member-uploads";

/**
 * POST /api/v1/me/avatar
 *
 * The one upload a member may make: the picture on their own profile.
 *
 * `/api/v1/upload` is the operator's door - 50 MB of anything on the media
 * library's allowlist, admin only - and widening it would have been the wrong
 * way to let a member change their face. What a member may store is a
 * different question, so it has its own answer and its own limits.
 *
 * Where the bytes land is not this file's business. `uploadFile` asks
 * whichever storage provider the site has active: the filesystem when no
 * provider module is installed, and whatever module is installed when one is.
 * Core names none of them, and a new provider needs no change here.
 */

/**
 * Pictures a browser draws, and nothing else.
 *
 * No SVG. It is a document that can carry script, and an avatar is shown
 * beside a member's name on every page they have ever posted on, which is the
 * widest audience any file on this site gets.
 */
const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

/** An avatar is drawn at eighty pixels. Two megabytes is already generous. */
const AVATAR_MAX_SIZE = 2 * 1024 * 1024;

/**
 * Per member, not per address. The cost of this endpoint is disk nobody
 * reviews, and the member is who spends it - a household behind one address
 * should not share a budget.
 */
const AVATAR_RATE = { maxRequests: 10, windowMs: 60 * 60 * 1000 };

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    const settings = await readSettingValues([MEMBER_AVATAR_UPLOADS_KEY]);
    if (!memberAvatarUploads(settings[MEMBER_AVATAR_UPLOADS_KEY])) {
        return NextResponse.json(
            { error: "Avatar uploads are turned off", code: "uploads_disabled" },
            { status: 403 },
        );
    }

    const allowed = await rateLimit(`avatar:${session.user.id}`, AVATAR_RATE);
    if (!allowed.success) {
        return NextResponse.json(
            { error: "Too many uploads, try again later", code: "rate_limited" },
            { status: 429 },
        );
    }

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ error: "Invalid form data", code: "invalid_body" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file provided", code: "no_file" }, { status: 400 });
    }

    const blob = file as File;

    // Both checks before the bytes are read: building the Buffer is what
    // costs the memory, and a refusal afterwards has already paid for it.
    if (blob.size > AVATAR_MAX_SIZE) {
        return NextResponse.json({ error: "That picture is too large", code: "too_large" }, { status: 413 });
    }
    if (!AVATAR_MIME.has(blob.type)) {
        return NextResponse.json({ error: "That is not a picture", code: "invalid_type" }, { status: 400 });
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    try {
        // `uploadFile` sniffs the bytes, so a `.exe` named `image/png` is
        // refused there rather than trusted here.
        const result = await uploadFile(buffer, blob.name, blob.type);

        try {
            await prisma.mediaItem.create({
                data: {
                    filename: blob.name,
                    url: result.url,
                    storagePath: result.path,
                    mimeType: blob.type,
                    size: blob.size,
                    uploadedById: session.user.id,
                },
            });
        } catch (err) {
            // The row is what an account deletion follows to take the file
            // back, so losing it matters more here than in the operator's
            // library. The upload still stands - the member has their
            // picture - and the gap is named rather than swallowed.
            log.warn("[avatar] Stored a picture with no library entry to delete it by", {
                url: result.url,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        return NextResponse.json({ url: result.url });
    } catch (err) {
        log.warn("[avatar] Upload refused", {
            error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: "That picture could not be stored", code: "upload_failed" }, { status: 400 });
    }
}
