import { z } from "zod";

/**
 * A game server the admin registers.
 *
 * The POST here was the least validated write in the platform: it read nine
 * fields off an untyped body and handed every one of them to Prisma. `name`
 * and `host` were required by the database rather than by the route, so
 * omitting them was a 500; the three port columns are `Int`, so a string port
 * was a 500 as well; and `rconPassword` reached `encryptSecret` as whatever
 * arrived, which is a throw on anything but a string.
 */
const port = z.number().int().min(1).max(65_535);

/** A path on this site or an http(s) address; "//" and "/\" lead to another host. */
const picture = z.string().trim().max(500).refine(
    (value) => /^\/(?![/\\])/.test(value) || /^https?:\/\//i.test(value),
    "A picture is a path on this site or an http(s) address",
);

export const serverCreateSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(100),
    type: z.string().trim().max(32).optional(),
    host: z.string().trim().min(1, "Host is required").max(255),
    port: port.optional(),
    rconPort: port.optional().nullable(),
    rconPassword: z.string().max(200).optional().nullable(),
    queryPort: port.optional().nullable(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
    order: z.number().int().min(0).max(10_000).optional(),
    description: z.string().trim().max(300).optional().nullable(),
    image: picture.optional().nullable(),
});

export const serverUpdateSchema = serverCreateSchema.partial();

/** One RCON command, and which server it goes to. */
export const rconCommandSchema = z.object({
    command: z.string().trim().min(1, "Command required").max(1_000),
    serverId: z.string().max(64).optional().nullable(),
});
