/**
 * The shape every game server endpoint shares: authenticate the token, check
 * the process is the current one, read and validate the body, then answer.
 *
 * Kept in one place so no endpoint can forget a step. Each handler file still
 * says `@provider-callback` itself, because the validator reads the file the
 * manifest names, and that marker is what lets it past the origin check.
 */
import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { readJsonBody } from "@/core/sdk/server";
import { authenticateServer, refuse, requireCurrentInstance, type ConnectedServer } from "./auth";

export type Answer = NextResponse;

export function ok(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** A POST whose body names the calling process in `instance`. */
export function serverPost<S extends z.ZodType<{ instance: string }>>(
    schema: S,
    handle: (server: ConnectedServer, body: z.infer<S>, request: NextRequest) => Promise<NextResponse>,
) {
    return async (request: NextRequest): Promise<NextResponse> => {
        const server = await authenticateServer(request);
        if (server instanceof NextResponse) return server;
        const raw = await readJsonBody(request);
        if (raw instanceof NextResponse) return raw;
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            return refuse(422, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request");
        }
        const superseded = await requireCurrentInstance(server, parsed.data.instance);
        if (superseded) return superseded;
        return handle(server, parsed.data, request);
    };
}

/** A GET, which carries no body and so no instance. */
export function serverGet(handle: (server: ConnectedServer, request: NextRequest) => Promise<NextResponse>) {
    return async (request: NextRequest): Promise<NextResponse> => {
        const server = await authenticateServer(request);
        if (server instanceof NextResponse) return server;
        return handle(server, request);
    };
}
