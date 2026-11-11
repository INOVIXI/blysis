"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_FACE_RULES, type MemberFaceRules } from "@/core/lib/member-face";

/**
 * How this site draws a member's face, handed down from the root layout.
 *
 * The layout reads the two settings on the server and passes plain data, so
 * every `MemberAvatar` on the page - in a server table or a client list -
 * draws the same face on the first paint, with no request of its own and no
 * database read in a client component.
 */
const MemberFaceContext = createContext<MemberFaceRules>(DEFAULT_FACE_RULES);

export function MemberFaceProvider({ rules, children }: { rules: MemberFaceRules; children: ReactNode }) {
    return <MemberFaceContext value={rules}>{children}</MemberFaceContext>;
}

/**
 * The rules in force. Outside the provider a member's own picture is drawn
 * and nothing else, which is how every face was drawn before there were rules.
 */
export function useMemberFaceRules(): MemberFaceRules {
    return useContext(MemberFaceContext);
}
