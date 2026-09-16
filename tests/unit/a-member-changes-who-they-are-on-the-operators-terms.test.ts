// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
    memberUsernameChanges,
    memberEmailChanges,
    identityRequiresPassword,
    emailChangeVerification,
} from "@/core/lib/member-identity";

/**
 * Three switches, and the defaults are the argument.
 *
 * A username could always be changed, so the switch that can take that away
 * starts on: an upgrade that silently removed something members were doing is
 * a change nobody asked for.
 *
 * An address could never be changed, and an address is where a password reset
 * link goes. That switch starts off, because opening that door is a decision
 * an operator makes rather than one they inherit.
 *
 * The two that guard the change start on, both times for the same reason: the
 * account is taken by whoever controls the mailbox. Without the password,
 * somebody who walks up to an unlocked screen owns the account by rewriting
 * one field. Without the verification, a typo sends every future reset to a
 * mailbox nobody reads.
 */

describe("what an installation does before anybody touches the settings", () => {
    it("lets a member change their username", () => {
        expect(memberUsernameChanges(undefined)).toBe(true);
    });

    it("does not let a member change their address", () => {
        expect(memberEmailChanges(undefined)).toBe(false);
    });

    it("asks for the current password", () => {
        expect(identityRequiresPassword(undefined)).toBe(true);
    });

    it("makes a new address prove itself", () => {
        expect(emailChangeVerification(undefined)).toBe(true);
    });
});

describe("what the operator said", () => {
    it("reads a toggle's boolean", () => {
        expect(memberUsernameChanges(false)).toBe(false);
        expect(memberEmailChanges(true)).toBe(true);
    });

    it("reads a choice control's string the same way", () => {
        // The same setting is written by a toggle on one screen and a two
        // value select on another. "false" and false have to mean one thing.
        expect(memberUsernameChanges("false")).toBe(false);
        expect(memberEmailChanges("true")).toBe(true);
        expect(identityRequiresPassword("false")).toBe(false);
        expect(emailChangeVerification("0")).toBe(false);
    });

    it("treats an empty value as nothing said", () => {
        expect(memberUsernameChanges("")).toBe(true);
        expect(memberEmailChanges("")).toBe(false);
    });
});
