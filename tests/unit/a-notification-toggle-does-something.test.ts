/**
 * Every row in the notification preferences grid is a switch on something.
 *
 * The grid in /profile was decorative in four separate ways at once, and each
 * one was invisible from the others.
 *
 * The columns it renders are `["email", "inapp"]`, and a row shows a toggle
 * only where `channels.includes(column)`. All five modules declared `"site"`.
 * So the In-app column was a dash on every row, and announcements, which
 * declared only `"site"`, had a row with no toggles in it at all.
 *
 * Two of the five named an event nothing fires. forum declared
 * `forum.topic.replied` and emits `forum.post.created`; store declared
 * `store.order.status.changed` and emits `store.order.completed`. A person
 * could mute either one forever without changing anything.
 *
 * And `shouldNotify`, the check that reads a saved preference back, was
 * called by nobody. Its own doc comment described a caller - "the in-app or
 * email sender calls shouldNotify before actually delivering" - that did not
 * exist, and it was not on the SDK, so no module could have been that caller
 * even by trying.
 *
 * Four separate pieces, each plausible on its own, adding up to a settings
 * screen that wrote rows nothing would ever read.
 *
 * A fifth was left standing. Four modules declared an `email` channel and
 * nothing on the platform has ever sent a notification email; three of the
 * nine declared events - a blog article, a forum reply, a ticket reply - had
 * no listener at all, in any channel, so their whole rows were decorative.
 * The forum reply and the ticket reply are delivered in-app now, and the
 * emitters carry the recipient so a listener does not have to read another
 * module's tables to find them. The blog article is a message to everybody
 * rather than to a person; that is what core's broadcasts are, so the
 * declaration went rather than growing a fan-out nobody asked for.
 *
 * The rule that keeps all of it honest is the last one below: a channel a
 * module offers has to be a channel something delivers.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { notificationTypeKey } from "@/core/components/profile/NotificationPrefsTab";

const MODULES = "module-sources";

/** The columns NotificationPrefsTab renders. A channel outside these is a dash. */
const RENDERED_CHANNELS = new Set(["email", "inapp"]);

interface Manifest {
    notificationTypes?: { eventType: string; label: string; channels?: string[] }[];
    hooksEmitted?: (string | { name?: string; hook?: string })[];
    hookListeners?: { hook: string; handler: string }[];
    translations?: Record<string, Record<string, Record<string, string>>>;
}

const manifests = new Map<string, Manifest>();
for (const id of fs.readdirSync(MODULES)) {
    const file = path.join(MODULES, id, "module.json");
    if (fs.existsSync(file)) manifests.set(id, JSON.parse(fs.readFileSync(file, "utf8")));
}

const fired = new Set<string>();
for (const manifest of manifests.values()) {
    for (const hook of manifest.hooksEmitted ?? []) {
        const name = typeof hook === "string" ? hook : hook.name ?? hook.hook;
        if (name) fired.add(name);
    }
}

const declared = [...manifests].flatMap(([id, m]) =>
    (m.notificationTypes ?? []).map((type) => ({ id, type })),
);

/**
 * Every event and channel some registered listener actually delivers, read
 * from the `shouldNotify` call each one has to make before sending.
 */
const ASKS_BEFORE_SENDING = /shouldNotify\([^)]*"([^"]+)",\s*"([^"]+)"\s*\)/g;

const delivered = new Set<string>();
for (const [id, manifest] of manifests) {
    for (const listener of manifest.hookListeners ?? []) {
        const file = path.join(MODULES, id, listener.handler);
        if (!fs.existsSync(file)) continue;
        for (const match of fs.readFileSync(file, "utf8").matchAll(ASKS_BEFORE_SENDING)) {
            delivered.add(`${match[1]}:${match[2]}`);
        }
    }
}

describe("a notification toggle does something", () => {
    it("has rows to check", () => {
        expect(declared.length).toBeGreaterThan(5);
    });

    it("names an event some module actually fires", () => {
        const phantom = declared
            .filter(({ type }) => !fired.has(type.eventType))
            .map(({ id, type }) => `${id}: ${type.eventType}`);
        expect(phantom).toEqual([]);
    });

    it("offers only channels the grid draws a switch for", () => {
        const invisible = declared
            .flatMap(({ id, type }) =>
                (type.channels ?? []).filter((c) => !RENDERED_CHANNELS.has(c)).map((c) => `${id}: ${c}`))
        expect(invisible).toEqual([]);
    });

    it("leaves no row with nothing to toggle", () => {
        const mute = declared
            .filter(({ type }) => (type.channels ?? []).length === 0)
            .map(({ id, type }) => `${id}: ${type.eventType}`);
        expect(mute).toEqual([]);
    });

    it("says each row in both languages", () => {
        const missing: string[] = [];
        for (const { id, type } of declared) {
            const key = notificationTypeKey(type.eventType);
            for (const locale of ["en", "tr"]) {
                if (!manifests.get(id)?.translations?.[locale]?.profile?.[key]) {
                    missing.push(`${id}: ${locale}.profile.${key}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("delivers every channel it offers", () => {
        // A channel with no sender is the same switch wired to nothing, one
        // level further out: the grid draws it, the preference saves, and the
        // event happens with nobody listening on that channel.
        const undeliverable = declared.flatMap(({ id, type }) =>
            (type.channels ?? [])
                .filter((channel) => !delivered.has(`${type.eventType}:${channel}`))
                .map((channel) => `${id}: ${type.eventType} over ${channel}`),
        );
        expect(undeliverable, undeliverable.join("\n")).toEqual([]);
    });

    it("shows a person what a row does and not what fires it", () => {
        // The grid printed the event name under the label, in monospace:
        // "Credits added to your balance", then "credits.credit.added". That
        // second line is a hook name. It means something to whoever wrote the
        // module and nothing to the person deciding whether they want the
        // email, and it is the reason the label and the description exist.
        const source = fs.readFileSync(
            path.join("src", "core", "components", "profile", "NotificationPrefsTab.tsx"),
            "utf8",
        );
        // `key={type.eventType}` is React bookkeeping and never reaches a
        // reader; a brace that is not an attribute's value is a text node.
        const rendered = source.match(/(?<!=)\{\s*type\.eventType\s*\}/g) ?? [];
        expect(rendered, "the raw event name is drawn on the screen").toEqual([]);
    });

    it("is read back by whatever sends the thing it mutes", () => {
        // A preference nothing consults is a switch wired to nothing.
        const listeners = path.join(MODULES, "in-app-notifications", "listeners");
        const files = fs.readdirSync(listeners);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const source = fs.readFileSync(path.join(listeners, file), "utf8");
            expect(source, `${file} sends without asking`).toContain("shouldNotify(");
        }
    });
});
