/**
 * Which releases this site is offered: the stable ones, or betas and release
 * candidates as well.
 *
 * The operator chooses on the update screen. `BLYSIS_UPDATE_CHANNEL` in
 * `.env` still wins when it names a channel, because an operator who pinned
 * one on the server meant it; the screen then shows the pin instead of a
 * switch that would do nothing. A value that names no channel is ignored
 * rather than read as a pin, so a typo leaves the screen in charge.
 */
import { prisma } from "@/core/lib/db";
import type { UpdateChannel } from "@/core/lib/core-releases";

const UPDATE_CHANNEL_SETTING_KEY = "update_channel";

export const UPDATE_CHANNELS = ["stable", "beta"] as const satisfies readonly UpdateChannel[];

export interface ChannelChoice {
    channel: UpdateChannel;
    /** True when `.env` decides, and the screen cannot. */
    pinned: boolean;
}

function asChannel(value: unknown): UpdateChannel | null {
    return typeof value === "string" && (UPDATE_CHANNELS as readonly string[]).includes(value.trim())
        ? (value.trim() as UpdateChannel)
        : null;
}

export async function getUpdateChannel(): Promise<ChannelChoice> {
    const pin = asChannel(process.env.BLYSIS_UPDATE_CHANNEL);
    if (pin) return { channel: pin, pinned: true };
    const row = await prisma.setting.findUnique({ where: { key: UPDATE_CHANNEL_SETTING_KEY } });
    return { channel: asChannel(row?.value) ?? "stable", pinned: false };
}

export async function setUpdateChannel(channel: UpdateChannel): Promise<void> {
    await prisma.setting.upsert({
        where: { key: UPDATE_CHANNEL_SETTING_KEY },
        update: { value: channel },
        create: { key: UPDATE_CHANNEL_SETTING_KEY, value: channel, module: "core" },
    });
}
