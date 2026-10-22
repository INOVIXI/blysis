import { describe, it, expect, beforeEach } from "vitest";
import { accountFor, identifierLookup, type AccountLookupClient } from "@/core/lib/login-identifier";
import { fakeTable } from "../modules/game-connect/fake-prisma";

describe("identifierLookup", () => {
    it("treats a value containing @ as an email", () => {
        expect(identifierLookup("admin@example.com")).toEqual({ email: "admin@example.com" });
    });

    it("treats a value without @ as a username", () => {
        expect(identifierLookup("siracozmen")).toEqual({ username: "siracozmen" });
    });

    it("trims whitespace browsers and password managers leave behind", () => {
        expect(identifierLookup("  admin@example.com  ")).toEqual({ email: "admin@example.com" });
        expect(identifierLookup("\tsiracozmen\n")).toEqual({ username: "siracozmen" });
    });

    it("keeps the value as it was typed; finding the account is accountFor's job", () => {
        expect(identifierLookup("Admin@Example.com")).toEqual({ email: "Admin@Example.com" });
        expect(identifierLookup("SiracOzmen")).toEqual({ username: "SiracOzmen" });
    });

    it("rejects anything that cannot identify an account", () => {
        expect(identifierLookup("")).toBeNull();
        expect(identifierLookup("   ")).toBeNull();
        expect(identifierLookup(undefined)).toBeNull();
        expect(identifierLookup(null)).toBeNull();
        expect(identifierLookup(42)).toBeNull();
        expect(identifierLookup({ email: "x@y.z" })).toBeNull();
    });

    it("accepts usernames made of the characters registration allows", () => {
        expect(identifierLookup("a_b-c9")).toEqual({ username: "a_b-c9" });
    });
});

/**
 * A member signs in with their name however they type it.
 *
 * Usernames and addresses are stored as they were written at registration,
 * and the lookup was exact, so somebody registered as `lonely_adam05` who
 * typed `Lonely_Adam05` was told the account did not exist. A site may still
 * hold two accounts that differ only in case, from before a name was held to
 * one person however it was capitalised: there the exact spelling decides,
 * and a spelling that matches both and neither exactly signs nobody in.
 */
describe("accountFor", () => {
    const users = fakeTable(() => ({}), "id", [["username"], ["email"]]);
    // The in-memory table answers with untyped rows; the query it reads is the real one.
    const prisma = { user: users } as unknown as AccountLookupClient;

    beforeEach(() => {
        users.table.rows = [
            { id: "u-adam", username: "lonely_adam05", email: "adam@example.com" },
            { id: "u-admin", username: "admin", email: "Admin@Example.com" },
            { id: "u-admin-twin", username: "Admin", email: "twin@example.com" },
        ];
    });

    it("finds a member whatever case their name is typed in", async () => {
        expect(await accountFor({ username: "Lonely_Adam05" }, prisma)).toEqual({ id: "u-adam" });
    });

    it("finds a member whatever case their address is typed in", async () => {
        expect(await accountFor({ email: "ADAM@example.COM" }, prisma)).toEqual({ id: "u-adam" });
        expect(await accountFor({ email: "admin@example.com" }, prisma)).toEqual({ id: "u-admin" });
    });

    it("lets the exact spelling decide between two names that differ only in case", async () => {
        expect(await accountFor({ username: "admin" }, prisma)).toEqual({ id: "u-admin" });
        expect(await accountFor({ username: "Admin" }, prisma)).toEqual({ id: "u-admin-twin" });
    });

    it("signs nobody in when a spelling matches two accounts and neither exactly", async () => {
        expect(await accountFor({ username: "ADMIN" }, prisma)).toBeNull();
    });

    it("finds nobody for a name nobody has", async () => {
        expect(await accountFor({ username: "nobody" }, prisma)).toBeNull();
    });
});
