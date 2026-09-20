"use client";

import { useState, useEffect } from "react";
import { Link, useRouter } from "@/core/sdk/navigation";
import { Button, Input, Label, Textarea, NativeSelect, buttonClassName } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { writeError } from "@/core/sdk";
import { DEFAULT_PRIORITIES, DEFAULT_PRIORITY, stateLabel, type TicketState } from "../../../../lib/ticket-states";

interface Department {
    id: string;
    name: string;
    description: string | null;
    color: string | null;
}

export default function NewTicketPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const t = useTranslations('tickets');
    const commonT = useTranslations('common');
    const [departments, setDepartments] = useState<Department[]>([]);
    /*
     * The desk's own priorities. Four were written into the select, so one an
     * operator added was offered nowhere a member could pick it. The shipped
     * four stand in until the list arrives, so the control is never empty.
     */
    const [priorities, setPriorities] = useState<TicketState[]>(
        DEFAULT_PRIORITIES.map((one) => ({ ...one, name: null })),
    );
    const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        subject: "",
        content: "",
        departmentId: "",
        priority: DEFAULT_PRIORITY,
    });

    useEffect(() => {
        fetch("/api/v1/tickets/departments")
            .then((res) => res.json())
            .then((data) => setDepartments(Array.isArray(data) ? data : data.departments || []))
            .catch(console.error)
            .finally(() => setDepartmentsLoaded(true));
    }, []);

    // The ticket list carries the desk's states, which is the only place a
    // member can be told about one an operator wrote.
    useEffect(() => {
        fetch("/api/v1/tickets")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (data?.states?.priorities?.length) setPriorities(data.states.priorities); })
            // The shipped four stand in, so a failure here narrows the
            // choice rather than emptying the control; the reason still goes
            // somewhere a developer can find it.
            .catch(console.error);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/v1/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const failed = await writeError(res, t('createTicketFailed'), t);
            if (failed) {
                throw new Error(failed);
            }

            const ticket = await res.json();
            router.push(`/support/${ticket.id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : commonT('somethingWentWrong'));
        } finally {
            setLoading(false);
        }
    };

    if (!session?.user) {
        return (
            <PageFrame
                title={t('createNewTicket')}
                trail={[{ label: t('title'), href: '/support' }]}
            >
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground mb-4">{t('loginToCreate')}</p>
                    <Link href="/auth/login" className={buttonClassName("default", "default")}>{t('login')}</Link>
                </div>
            </PageFrame>
        );
    }

    return (
        <PageFrame
            title={t('createNewTicket')}
            trail={[{ label: t('title'), href: '/support' }]}
        >
            {/* The card spans the page. It used to be max-w-3xl inside a
                full-width one, which left the right half of every screen
                empty beside a form that looked cut off. */}
            <div className="bg-card rounded-xl border border-border p-6">
                {departmentsLoaded && departments.length === 0 ? (
                    <div className="text-center py-10">
                        <p className="font-medium text-foreground">{t('noDepartmentsTitle')}</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{t('noDepartmentsHelp')}</p>
                    </div>
                ) : (<>
                {error && (
                    <div role="alert" className="mb-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <Label htmlFor="department">{t('department')} *</Label>
                            <NativeSelect
                                id="department"
                                value={formData.departmentId}
                                onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })} className="w-full mt-1"
                                required
                            >
                                <option value="">{t('selectDepartment')}</option>
                                {departments.map((dept) => (
                                    <option key={dept.id} value={dept.id}>
                                        {dept.name}
                                    </option>
                                ))}
                            </NativeSelect>
                        </div>

                        <div>
                            <Label htmlFor="priority">{t('priority')}</Label>
                            <NativeSelect
                                id="priority"
                                value={formData.priority}
                                onChange={(e) => setFormData({ ...formData, priority: e.target.value })} className="w-full mt-1"
                            >
                                {/* The desk's own priorities: four were
                                    written here, so one an operator added was
                                    offered nowhere a member could pick it. */}
                                {priorities.map((priority) => (
                                    <option key={priority.key} value={priority.key}>
                                        {stateLabel(t, priority.key, priorities)}
                                    </option>
                                ))}
                            </NativeSelect>
                        </div>
                    </div>

                    <div>
                        <Label htmlFor="subject">{t('subject')} *</Label>
                        <Input
                            id="subject"
                            type="text"
                            value={formData.subject}
                            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                            className="mt-1"
                            placeholder={t('briefDescription')}
                            required
                        />
                    </div>

                    <div>
                        <Label htmlFor="content">{t('message')} *</Label>
                        <Textarea
                            id="content"
                            value={formData.content}
                            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                            placeholder={t('describeIssue')}
                            rows={8}
                            required
                        />
                    </div>

                    <div className="flex gap-3">
                        <Button type="submit" disabled={loading}>
                            {loading ? t('creating') : t('createTicket')}
                        </Button>
                        <Link href="/support" className={buttonClassName("outline", "default")}>{t('cancel')}</Link>
                    </div>
                </form>
                </>)}
            </div>
        </PageFrame>
    );
}
