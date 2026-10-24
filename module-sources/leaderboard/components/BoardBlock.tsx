"use client";

import { useBlockText, type BlockProps } from "@/core/sdk/ui";
import { BoardCard } from "./BoardCard";

/**
 * `leaderboard.board`: the leaderboard widget, which a theme can point at one
 * board and give a title of its own, a message key or the operator's words.
 * With no board it is the widget, every board in its tabs.
 */
export function BoardBlock({ settings }: BlockProps) {
    const text = useBlockText();
    const only = typeof settings.board === "string" ? settings.board.trim() : "";
    return <BoardCard only={only || undefined} title={text(settings.title) || undefined} />;
}
