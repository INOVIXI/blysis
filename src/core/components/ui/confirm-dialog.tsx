"use client";

import { useState, useCallback, useRef, useId, createContext, useContext } from "react";
import { useTranslations } from "next-intl";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { Button } from "@/core/components/ui/button";
import { ModalLayer } from "@/core/components/ui/modal-layer";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "danger" | "default";
}

/**
 * Asking for one line of text, in the reader's language and inside the page.
 *
 * `prompt()` is the browser's, so it renders in the browser's chrome with the
 * browser's own buttons, ignores the site's language, blocks the main thread
 * and is silently suppressed in some contexts - two admin screens asked for a
 * ban reason and a rejection reason that way, in English, whatever language
 * the admin had chosen.
 */
export interface PromptOptions {
    title?: string;
    message: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    /** Refuse an empty answer. Off by default: most of these are optional. */
    required?: boolean;
}

interface ConfirmContextType {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    /** Resolves to the text, or null when the reader backed out. */
    ask: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextType>({
    confirm: () => Promise.resolve(false),
    ask: () => Promise.resolve(null),
});

export function useConfirm() {
    return useContext(ConfirmContext);
}

export function usePrompt() {
    return useContext(ConfirmContext).ask;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const t = useTranslations("common");
    const inputId = useId();
    const [state, setState] = useState<{
        open: boolean;
        options: ConfirmOptions & PromptOptions;
        /** Set for a prompt; the dialog then asks for a line of text. */
        asking: boolean;
        resolve: ((value: boolean | string | null) => void) | null;
    }>({
        open: false,
        options: { message: "" },
        asking: false,
        resolve: null,
    });
    const [answer, setAnswer] = useState("");

    const stateRef = useRef(state);
    stateRef.current = state;
    // handleClose is memoised with no deps, so it must not close over the
    // answer: the ref is what the dialog was showing when it was dismissed.
    const answerRef = useRef(answer);
    answerRef.current = answer;

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setState({ open: true, options, asking: false, resolve: resolve as (v: boolean | string | null) => void });
        });
    }, []);

    const ask = useCallback((options: PromptOptions): Promise<string | null> => {
        return new Promise((resolve) => {
            setAnswer(options.defaultValue ?? "");
            setState({ open: true, options, asking: true, resolve: resolve as (v: boolean | string | null) => void });
        });
    }, []);

    const handleClose = useCallback((accepted: boolean) => {
        const { asking, resolve } = stateRef.current;
        // A prompt answers with the text or with null; a confirm answers with
        // the boolean. Backing out of either is null / false, never "".
        resolve?.(asking ? (accepted ? answerRef.current : null) : accepted);
        setState({ open: false, options: { message: "" }, asking: false, resolve: null });
        setAnswer("");
    }, []);

    // Escape, the Tab trap and returning focus to whatever opened the dialog
    // all live in one place now. This component used to be the only one in the
    // product that had them, which is how the other eleven dialogs came to ship
    // `aria-modal="true"` over a page Tab could still walk into.
    const dialogRef = useModalDialog<HTMLDivElement>(state.open, () => handleClose(false));
    const blocked = state.asking && state.options.required === true && answer.trim() === "";

    return (
        <ConfirmContext.Provider value={{ confirm, ask }}>
            {children}
            {state.open && (
                <ModalLayer>
                    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
                        <div className="fixed inset-0 bg-black/50" onClick={() => handleClose(false)} aria-hidden="true" />
                        <div
                            ref={dialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="confirm-title"
                            aria-describedby="confirm-message"
                            className="relative bg-card border border-[var(--blysis-color-border)] rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto animate-fade-in"
                        >
                            <div className="flex items-start gap-4">
                                {state.options.variant === "danger" && (
                                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                                        <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                                    </div>
                                )}
                                <div className="flex-1">
                                    {state.options.title && (
                                        <h2 id="confirm-title" className="font-semibold text-foreground mb-1">{state.options.title}</h2>
                                    )}
                                    <p id="confirm-message" className="text-sm text-muted-foreground">{state.options.message}</p>
                                    {state.asking && (
                                        <input
                                            id={inputId}
                                            aria-label={state.options.message}
                                            autoFocus
                                            value={answer}
                                            placeholder={state.options.placeholder}
                                            onChange={(e) => setAnswer(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter" && !blocked) handleClose(true); }}
                                            className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <Button variant="outline" size="sm" onClick={() => handleClose(false)}>
                                    {state.options.cancelText || t("cancel")}
                                </Button>
                                <Button
                                    variant={state.options.variant === "danger" ? "destructive" : "default"}
                                    size="sm"
                                    disabled={blocked}
                                    onClick={() => handleClose(true)}
                                >
                                    {state.options.confirmText || t("confirm")}
                                </Button>
                            </div>
                        </div>
                    </div>
                </ModalLayer>
            )}
        </ConfirmContext.Provider>
    );
}
