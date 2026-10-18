import { formatSiteCurrency, log, queueEmail } from "@/core/sdk/server";

/**
 * The buyer's order confirmation.
 *
 * This used to be a second Resend client of the module's own, built straight
 * from `process.env.RESEND_API_KEY`. That skipped four things core does for
 * every other message: the `EmailJob` queue and its retries, the
 * `email.subject` / `email.body` filters a module can listen on, the header
 * injection guard, and the admin's own `resend_api_key` / `email_from` rows.
 * It also wrote the total as `$12.00` whatever `default_currency` said, and
 * wrote it in English to every buyer.
 *
 * The strings are inline rather than read through next-intl because this runs
 * from a gateway webhook, which has no request locale to inherit; the buyer's
 * stored locale is the only thing that knows what language they read. Core's
 * own transactional emails are built the same way, for the same reason.
 */

interface OrderEmailStrings {
    subject: string;
    heading: string;
    intro: string;
    orderLabel: string;
    totalLabel: string;
    footer: string;
}

const STRINGS: Record<string, OrderEmailStrings> = {
    en: {
        subject: "Order confirmation",
        heading: "Order confirmed",
        intro: "Thank you for your purchase. We have received your order.",
        orderLabel: "Order",
        totalLabel: "Total",
        footer: "You can view your order details in your profile.",
    },
    tr: {
        subject: "Sipariş onayı",
        heading: "Siparişiniz onaylandı",
        intro: "Satın aldığınız için teşekkürler. Siparişinizi aldık.",
        orderLabel: "Sipariş",
        totalLabel: "Toplam",
        footer: "Sipariş ayrıntılarını profilinizden görebilirsiniz.",
    },
    az: {
        subject: "Sifariş təsdiqi",
        heading: "Sifariş təsdiqləndi",
        intro: "Alışınız üçün təşəkkür edirik. Sifarişiniz qəbul edildi.",
        orderLabel: "Sifariş",
        totalLabel: "Cəmi",
        footer: "Sifariş təfərrüatlarına profilinizdən baxa bilərsiniz.",
    },
    de: {
        subject: "Bestellbestätigung",
        heading: "Bestellung bestätigt",
        intro: "Vielen Dank für deinen Einkauf. Wir haben deine Bestellung erhalten.",
        orderLabel: "Bestellung",
        totalLabel: "Gesamt",
        footer: "Du kannst die Details deiner Bestellung in deinem Profil ansehen.",
    },
    es: {
        subject: "Confirmación de pedido",
        heading: "Pedido confirmado",
        intro: "Gracias por tu compra. Hemos recibido tu pedido.",
        orderLabel: "Pedido",
        totalLabel: "Total",
        footer: "Puedes ver los detalles de tu pedido en tu perfil.",
    },
    et: {
        subject: "Tellimuse kinnitus",
        heading: "Tellimus kinnitatud",
        intro: "Aitäh ostu eest. Oleme sinu tellimuse kätte saanud.",
        orderLabel: "Tellimus",
        totalLabel: "Kokku",
        footer: "Tellimuse üksikasju näed oma profiilis.",
    },
    fr: {
        subject: "Confirmation de commande",
        heading: "Commande confirmée",
        intro: "Merci pour votre achat. Nous avons bien reçu votre commande.",
        orderLabel: "Commande",
        totalLabel: "Total",
        footer: "Vous pouvez consulter les détails de votre commande dans votre profil.",
    },
    it: {
        subject: "Conferma dell’ordine",
        heading: "Ordine confermato",
        intro: "Grazie per il tuo acquisto. Abbiamo ricevuto il tuo ordine.",
        orderLabel: "Ordine",
        totalLabel: "Totale",
        footer: "Puoi vedere i dettagli del tuo ordine nel tuo profilo.",
    },
    pl: {
        subject: "Potwierdzenie zamówienia",
        heading: "Zamówienie potwierdzone",
        intro: "Dziękujemy za zakup. Otrzymaliśmy Twoje zamówienie.",
        orderLabel: "Zamówienie",
        totalLabel: "Razem",
        footer: "Szczegóły zamówienia znajdziesz w swoim profilu.",
    },
    pt: {
        subject: "Confirmação do pedido",
        heading: "Pedido confirmado",
        intro: "Obrigado pela sua compra. Recebemos o seu pedido.",
        orderLabel: "Pedido",
        totalLabel: "Total",
        footer: "Você pode ver os detalhes do seu pedido no seu perfil.",
    },
    ru: {
        subject: "Подтверждение заказа",
        heading: "Заказ подтвержден",
        intro: "Спасибо за покупку. Мы получили ваш заказ.",
        orderLabel: "Заказ",
        totalLabel: "Итого",
        footer: "Подробности заказа можно посмотреть в вашем профиле.",
    },
    zh: {
        subject: "订单确认",
        heading: "订单已确认",
        intro: "感谢你的购买。我们已收到你的订单。",
        orderLabel: "订单",
        totalLabel: "总计",
        footer: "你可以在个人资料中查看订单详情。",
    },
};

function stringsFor(locale: string | null | undefined): OrderEmailStrings {
    return STRINGS[(locale ?? "en").slice(0, 2)] ?? STRINGS.en;
}

/**
 * The same five characters core's mail sender escapes.
 *
 * The apostrophe was missing here. Nothing in this file puts a value inside a
 * single quoted attribute, so nothing was getting through, but two functions
 * with one name that behave differently are indistinguishable at the call
 * site, and the difference only shows the day somebody writes
 * `href='${escapeHtml(url)}'` in whichever file has the shorter one.
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export async function sendOrderConfirmationEmail(input: {
    to: string;
    orderNumber: string;
    total: number;
    locale?: string | null;
}): Promise<void> {
    const t = stringsFor(input.locale);
    const total = await formatSiteCurrency(input.total, input.locale ?? "en");
    const orderNumber = escapeHtml(input.orderNumber);
    const subject = `${t.subject} - ${input.orderNumber}`;

    const body = [
        t.heading,
        "",
        t.intro,
        `${t.orderLabel}: ${input.orderNumber}`,
        `${t.totalLabel}: ${total}`,
        "",
        t.footer,
    ].join("\n");

    const html = `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1f2937;">${escapeHtml(t.heading)}</h2>
                <p style="color: #6b7280;">${escapeHtml(t.intro)}</p>
                <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
                    <p style="margin: 0; color: #1f2937;"><strong>${escapeHtml(t.orderLabel)}:</strong> ${orderNumber}</p>
                    <p style="margin: 4px 0 0; color: #1f2937;"><strong>${escapeHtml(t.totalLabel)}:</strong> ${escapeHtml(total)}</p>
                </div>
                <p style="color: #6b7280;">${escapeHtml(t.footer)}</p>
            </div>
        `;

    const id = await queueEmail({ to: input.to, subject, body, html });
    if (!id) {
        log.warn("[store] order confirmation could not be queued", { orderNumber: input.orderNumber });
    }
}
