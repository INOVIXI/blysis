import type { Prisma } from "@prisma/client";

/**
 * What a game server row may be told to a client.
 *
 * `rconPassword` is encrypted at rest and `rconPort` is the door it opens;
 * neither belongs in a response. The list endpoint has always selected around
 * them, but `POST /servers` and `PATCH /servers/[id]` returned the whole row
 * Prisma handed back, so the ciphertext of the password an admin had just
 * typed came straight back down the wire and into whatever sits between: a
 * proxy log, the browser's memory, an error reporter.
 *
 * One list, used by every handler that answers with a server.
 */
export const SERVER_PUBLIC_FIELDS = {
    id: true,
    name: true,
    type: true,
    host: true,
    port: true,
    queryPort: true,
    isDefault: true,
    isActive: true,
    order: true,
    description: true,
    image: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.GameServerSelect;
