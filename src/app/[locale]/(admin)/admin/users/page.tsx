import { Link } from "@/core/lib/i18n/navigation";
import { redirect } from "@/core/lib/i18n/navigation";
import { getSession } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { canOpenAdminPage } from "@/core/lib/permissions";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { formatDate } from "@/core/lib/utils";
import { Pagination } from "@/core/components/ui/pagination";
import { ListControls } from "@/core/components/ui/list-controls";
import { UserRoleSelect } from "./role-select";
import { dateLocaleTag } from "@/core/lib/utils";
import { MemberAvatar } from "@/core/components/ui/MemberAvatar";
import { Badge } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The term narrows the query, not the page.
 *
 * This list is paged by the database and a site can hold a hundred thousand
 * members, so searching the fifty rows that happened to arrive would tell an
 * operator there is no such member because they are on page nine hundred.
 *
 * Name and address, because those are the two the table draws. Postgres
 * folds case for `mode: "insensitive"`, and both columns are indexed for the
 * uniqueness they already enforce.
 */
function matching(term: string) {
    if (term === "") return {};
    return {
        OR: [
            { username: { contains: term, mode: "insensitive" as const } },
            { email: { contains: term, mode: "insensitive" as const } },
        ],
    };
}

async function getUsers(page: number, limit: number, term: string) {
    const where = matching(term);
    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            include: {
                role: true,
                _count: true,
            },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: "desc" },
        }),
        prisma.user.count({ where }),
    ]);

    return { users, total };
}

async function getRoles() {
    return prisma.role.findMany({ orderBy: { priority: "desc" } });
}

interface PageProps {
    searchParams: Promise<{ page?: string; q?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
    const session = await getSession();
    const locale = await getLocale();
    if (!session?.user) redirect({ href: "/auth/login", locale });

    if (!(await canOpenAdminPage(session.user.id, `/${locale}/admin/users`))) {
        redirect({ href: "/admin", locale });
    }

    const sp = await searchParams;
    const requestedPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
    const term = (sp.q ?? "").trim();

    const [{ users, total }, roles] = await Promise.all([
        getUsers(requestedPage, PAGE_SIZE, term),
        getRoles(),
    ]);
    const t = await getTranslations("admin");
    const commonT = await getTranslations("common");
    const dateTag = dateLocaleTag(locale);

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);

    return (
        <>
            <AdminPageHeader
                title={t("users_title")}
                description={t("users_total", { count: total })}
            />

            <ListControls className="mb-4" search={{ param: "q" }} />

            <Card>
                <CardHeader>
                    <CardTitle>{t("users_allUsers")}</CardTitle>
                </CardHeader>
                <CardContent>
                    {users.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {/* Not "no members yet" in front of a site full of
                                them: that sentence tells an operator their
                                data has gone. */}
                            {term === "" ? t("users_noUsers") : commonT("noResults")}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("users_user")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("users_email")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("users_role")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("users_joined")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((user) => (
                                        <tr key={user.id} className="hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    <MemberAvatar name={user.username} src={user.avatar} size={32} />
                                                    <Link href={`/admin/users/${user.id}`} className="font-medium hover:text-primary transition-colors">
                                                        {user.username}
                                                        {user.isBanned && <Badge tone="danger" className="ml-2">{t("users_banned")}</Badge>}
                                                    </Link>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground">{user.email}</td>
                                            <td className="py-3 px-4">
                                                <UserRoleSelect
                                                    userId={user.id}
                                                    currentRoleId={user.roleId || ""}
                                                    roles={roles.map((r) => ({ id: r.id, name: r.name, displayName: r.displayName, color: r.color }))}
                                                />
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground">
                                                {formatDate(user.createdAt, undefined, dateTag)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <Pagination
                        page={page}
                        pages={pageCount}
                        total={total}
                        pageParam="page"
                    />
                </CardContent>
            </Card>
        </>
    );
}
