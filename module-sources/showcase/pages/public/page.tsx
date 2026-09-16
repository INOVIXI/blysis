/**
 * The showcase, written by the server.
 *
 * The page fetched its cards after it had loaded, so the HTML the server sent
 * carried no card and no heading: measured, 58 characters of text inside
 * `<main>`. Nothing on this page needs a browser.
 */
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { PageFrame } from "@/core/sdk/layout";
import { Card, CardContent } from "@/core/sdk/ui";
import { readShowcaseCards } from "../../lib/read-cards";

interface ShowcaseCard {
    id: string;
    title: string;
    body: string | null;
    image: string | null;
    href: string | null;
}

function CardFace({ card }: { card: ShowcaseCard }) {
    return (
        <Card className="h-full overflow-hidden">
            {card.image && (
                <div className="relative aspect-video w-full bg-muted">
                    <Image
                        src={card.image}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover"
                    />
                </div>
            )}
            <CardContent className="p-5">
                <p className="font-semibold">{card.title}</p>
                {card.body && <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>}
            </CardContent>
        </Card>
    );
}

export default async function ShowcasePage() {
    const t = await getTranslations("showcase");
    const cards = await readShowcaseCards();

    return (
        <PageFrame title={t("title")} description={t("subtitle")}>
            {cards.length === 0 ? (
                <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">{t("empty")}</p></CardContent></Card>
            ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {cards.map((card) =>
                        card.href ? (
                            /*
                             * Named, because the whole card is the link and its
                             * picture is decorative: without this a screen
                             * reader announces a link and then reads the
                             * heading as if it were separate.
                             */
                            <Link key={card.id} href={card.href} aria-label={card.title} className="block focus-visible:outline-2">
                                <CardFace card={card} />
                            </Link>
                        ) : (
                            <CardFace key={card.id} card={card} />
                        ),
                    )}
                </div>
            )}
        </PageFrame>
    );
}
