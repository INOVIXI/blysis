import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIP, rateLimits } from "./rate-limit";

/**
 * What this platform's HTTP answers look like, and what these helpers are for.
 *
 * This comment used to say that every endpoint should answer through
 * `apiSuccess` / `apiError` / `apiPaginated`, and that the ad-hoc shapes were
 * legacy being migrated incrementally. Measured on 2026-09-20: 3 of 104 core
 * route files call `apiSuccess` or `apiPaginated`, 2 of 189 module ones do,
 * and refusals are 416 plain `{ error }` against 19 through `apiError`. A
 * migration that has moved three percent of the surface is not in progress;
 * it is a note somebody left. So this describes the contract the code keeps.
 *
 * **A refusal carries `error`.** Any 4xx or 5xx answers with
 * `{ error: "<a sentence>", code?: "<machine_code>" }` and the status. This is
 * the one part that is a real contract: `writeError` and `errorMessage` are
 * how every screen in the panel turns a failed request into words, and both
 * read that key. A route answering 4xx with anything else hands the screen a
 * body it has no branch for. `a-refusal-says-it-refused.test.ts` holds it
 * across core and every module. Add `code` wherever a caller has to branch,
 * so it branches on a stable word rather than on an English sentence.
 *
 * **A success is the endpoint's own shape.** `{ items, total }`, the row, the
 * count: there is no envelope, and adding one to an endpoint that already has
 * callers changes what they read. `/api/v1/` is consumed by the admin panel,
 * by 89 modules and by whatever an operator has written against it, so the
 * shape of a success is part of that endpoint rather than a house style.
 *
 * The helpers below stay for the endpoints that use them, and `apiPaginated`
 * is worth reaching for when writing a new list that wants a pagination block
 * rather than inventing a fourth one. What is not worth doing is converting a
 * working endpoint to them: that is a wire change dressed as a tidy-up.
 */
export interface ApiSuccess<T> {
    ok: true;
    data: T;
    pagination?: {
        page: number;
        limit: number;
        total: number;
        pages: number;
        hasMore: boolean;
    };
}

export interface ApiFailure {
    ok: false;
    error: string;
    code?: string;
    details?: unknown;
}

export type ApiResponseBody<T> = ApiSuccess<T> | ApiFailure;

export interface ApiErrorOptions {
    code?: string;
    details?: unknown;
    headers?: HeadersInit;
}

export function apiSuccess<T>(data: T, status = 200, headers?: HeadersInit): NextResponse {
    const body: ApiSuccess<T> = { ok: true, data };
    return NextResponse.json(body, { status, headers });
}

export function apiError(message: string, status = 400, options: ApiErrorOptions = {}): NextResponse {
    const body: ApiFailure = { ok: false, error: message };
    if (options.code) body.code = options.code;
    if (options.details !== undefined) body.details = options.details;
    return NextResponse.json(body, { status, headers: options.headers });
}

/**
 * Return the error message only outside production. In production we mask
 * internal details so a crashing Prisma / fs / fetch call cannot leak DB
 * hostnames, filesystem paths, stack frames, or other reconnaissance data
 * to the caller. Use this whenever `err.message` would otherwise appear
 * verbatim in a response body.
 *
 *   catch (err) {
 *     return apiError("Upload failed", 500, { details: devOnlyDetail(err) });
 *   }
 *
 * `details` is dropped by apiError when undefined so the wire envelope
 * stays clean.
 */
export function devOnlyDetail(err: unknown): string | undefined {
    if (process.env.NODE_ENV === "production") return undefined;
    if (err instanceof Error) return err.message;
    if (err === undefined || err === null) return undefined;
    return String(err);
}

export function apiPaginated<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
    status = 200,
): NextResponse {
    const body: ApiSuccess<T[]> = {
        ok: true,
        data: items,
        pagination: {
            page,
            limit,
            total,
            pages: Math.max(1, Math.ceil(total / Math.max(1, limit))),
            hasMore: page * limit < total,
        },
    };
    return NextResponse.json(body, { status });
}

/**
 * Wrap a handler with per-route, IP-based rate limiting. The envelope uses the
 * standard `apiError` shape with `code: "rate_limited"` so clients can branch
 * on it cleanly.
 *
 * `scope` names the bucket, and it is required because the alternative was
 * worse than it looked. This wrapper used to hit the limiter with the bare IP
 * as the key, which meant every route using it shared one counter: a licence
 * server checking keys from an office spent the same budget that the people
 * behind that NAT needed to search the site or sign in through Steam, and a
 * route asking for a tighter limit could not get one, because the count it
 * read was everybody's. Every hand-written call to `rateLimit` in the codebase
 * already prefixed its key - `register:`, `gift-redeem:`, `2fa-verify:` - and
 * this is the same discipline, enforced by the signature.
 *
 * The scope is a fixed name, never anything from the request. A key built from
 * a path with an id in it is a different bucket per id, which is no limit at
 * all to a caller who can vary the id.
 */
export function withRateLimit(
    scope: string,
    handler: (request: NextRequest, ...args: unknown[]) => Promise<NextResponse>,
    config = rateLimits.api,
) {
    return async (request: NextRequest, ...args: unknown[]) => {
        const ip = getClientIP(request.headers);
        const { success, remaining, resetAt } = await rateLimit(`${scope}:${ip}`, config);

        if (!success) {
            return apiError("Too many requests. Please try again later.", 429, {
                code: "rate_limited",
                headers: {
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
                    "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
                },
            });
        }

        const response = await handler(request, ...args);
        response.headers.set("X-RateLimit-Remaining", String(remaining));
        return response;
    };
}
