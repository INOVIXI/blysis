"use client";

import { useCallback, useRef, useState } from "react";
import { Slot } from "@/core/components/Slot";
import type { AuthChallengeAction } from "@/core/lib/auth-challenge-shared";

/**
 * Where a module gets to put a check in front of a form.
 *
 * Core renders this inside the login, register and forgot-password forms, and
 * a module renders it inside its own - a topic, a suggestion, a submission -
 * naming the point it declared in its manifest. Core has no idea whether
 * anything fills it. With no challenge module installed the slot has no
 * contributions, this renders nothing, and `useChallenge()` hands
 * the form an empty object that changes none of its behaviour.
 *
 * A module's slot component receives `action` (so one widget can behave
 * differently on login and register) and `onField`, and reports whatever it
 * needs the server to see. Core forwards the collected fields verbatim and
 * never looks inside them: naming them is the module's business, and a
 * second challenge module would simply add its own.
 */
export function useChallenge() {
    const fields = useRef<Record<string, string>>({});
    // Re-render when a field arrives so a form can tell whether a widget has
    // produced anything yet.
    const [ready, setReady] = useState(false);

    const onField = useCallback((name: string, value: string) => {
        if (typeof name !== "string" || !name) return;
        if (value) fields.current[name] = String(value);
        else delete fields.current[name];
        setReady(Object.keys(fields.current).length > 0);
    }, []);

    const read = useCallback(() => ({ ...fields.current }), []);

    return { onField, read, ready };
}

export function Challenge({
    action,
    onField,
}: {
    action: AuthChallengeAction;
    onField: (name: string, value: string) => void;
}) {
    return <Slot name="auth.form.challenge" context={{ action, onField }} />;
}
