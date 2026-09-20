import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Three servers, on hosts that will never answer.
 *
 * `.invalid` is reserved and resolves nowhere, so every one of these reports
 * offline in a few milliseconds rather than holding a socket open for the
 * timeout. That is the honest demo: there is no game server behind a demo
 * site, and "offline" is a state the widget has to draw anyway.
 *
 * What the rows are for is the panel. Two protocols, so the list is not one
 * kind of server repeated; one marked default, because that is the row the
 * old single-server status field describes; one turned off, which used to be
 * a row that vanished from the only screen that could turn it back on.
 *
 * No RCON password. It is a credential, and a credential does not belong in
 * a file that ships in a ZIP.
 */
const SERVERS: [string, string, string, number, number | null, boolean, boolean][] = [
    ["Survival", "minecraft", "survival.demo.invalid", 25565, 25565, true, true],
    ["Rust Main", "rust", "rust.demo.invalid", 28015, 28016, false, true],
    ["Creative (retired)", "minecraft", "creative.demo.invalid", 25566, null, false, false],
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        for (const [order, [name, type, host, port, queryPort, isDefault, isActive]] of SERVERS.entries()) {
            const existing = await ctx.prisma.gameServer.findFirst({ where: { name } });
            if (existing) continue;
            await ctx.create("gameServer", () => ctx.prisma.gameServer.create({
                data: { name, type, host, port, queryPort, isDefault, isActive, order },
            }));
        }
        ctx.log(`${SERVERS.length} game servers`);
    },
};
