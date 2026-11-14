import { formatSiteCurrency, log, queueEmail, resolveAppUrl } from "@/core/sdk/server";
import { escapeHtml } from "./order-email";

/**
 * The one reminder about a checkout that was started and never paid for.
 *
 * Inline strings for the reason `order-email.ts` gives: this runs from the
 * scheduler, which has no request locale, and the buyer's stored locale is
 * the only thing that knows what they read.
 *
 * It says why it arrived and where to stop it, because it is a message the
 * buyer did not ask for in so many words. The switch is the buyer's own
 * notification settings, which the sweep reads before it sends.
 */

interface ReminderStrings {
    subject: string;
    heading: string;
    introOrder: string;
    introTopUp: string;
    orderLabel: string;
    totalLabel: string;
    action: string;
    footer: string;
    settings: string;
}

const STRINGS: Record<string, ReminderStrings> = {
    en: {
        subject: "Your purchase is not finished yet",
        heading: "You left something behind",
        introOrder: "You started an order but the payment did not go through. Your basket can be filled again in one click.",
        introTopUp: "You started a credit top-up but the payment did not go through. You can pick it up again from your credits.",
        orderLabel: "Order",
        totalLabel: "Total",
        action: "Finish your purchase",
        footer: "We send this once, because you started a checkout on our site.",
        settings: "Turn these reminders off",
    },
    tr: {
        subject: "Satın alman henüz tamamlanmadı",
        heading: "Yarım kalan bir alışverişin var",
        introOrder: "Bir sipariş başlattın ama ödeme tamamlanmadı. Sepetini tek tıkla yeniden doldurabilirsin.",
        introTopUp: "Bir kredi yüklemesi başlattın ama ödeme tamamlanmadı. Kredilerin sayfasından kaldığın yerden devam edebilirsin.",
        orderLabel: "Sipariş",
        totalLabel: "Toplam",
        action: "Satın almayı tamamla",
        footer: "Sitemizde bir ödeme başlattığın için bunu yalnızca bir kez gönderiyoruz.",
        settings: "Bu hatırlatmaları kapat",
    },
    az: {
        subject: "Alışınız hələ tamamlanmayıb",
        heading: "Yarımçıq qalan alışınız var",
        introOrder: "Sifariş başlatdınız, lakin ödəniş tamamlanmadı. Səbətinizi bir kliklə yenidən doldura bilərsiniz.",
        introTopUp: "Kredit artırılmasına başladınız, lakin ödəniş tamamlanmadı. Kreditlər bölməsindən davam edə bilərsiniz.",
        orderLabel: "Sifariş",
        totalLabel: "Cəmi",
        action: "Alışı tamamlayın",
        footer: "Saytımızda ödəniş başlatdığınız üçün bunu yalnız bir dəfə göndəririk.",
        settings: "Bu xatırlatmaları söndürün",
    },
    de: {
        subject: "Dein Kauf ist noch nicht abgeschlossen",
        heading: "Da ist noch etwas offen",
        introOrder: "Du hast eine Bestellung begonnen, aber die Zahlung kam nicht durch. Dein Warenkorb lässt sich mit einem Klick wieder füllen.",
        introTopUp: "Du hast eine Guthabenaufladung begonnen, aber die Zahlung kam nicht durch. Du kannst sie bei deinen Credits fortsetzen.",
        orderLabel: "Bestellung",
        totalLabel: "Gesamt",
        action: "Kauf abschließen",
        footer: "Wir senden das nur einmal, weil du auf unserer Seite einen Kauf begonnen hast.",
        settings: "Diese Erinnerungen abschalten",
    },
    es: {
        subject: "Tu compra aún no ha terminado",
        heading: "Te dejaste algo pendiente",
        introOrder: "Empezaste un pedido pero el pago no se completó. Puedes volver a llenar tu carrito con un clic.",
        introTopUp: "Empezaste una recarga de créditos pero el pago no se completó. Puedes retomarla desde tus créditos.",
        orderLabel: "Pedido",
        totalLabel: "Total",
        action: "Terminar la compra",
        footer: "Te lo enviamos una sola vez porque empezaste un pago en nuestro sitio.",
        settings: "Desactivar estos recordatorios",
    },
    et: {
        subject: "Sinu ost ei ole veel lõpetatud",
        heading: "Midagi jäi pooleli",
        introOrder: "Alustasid tellimust, kuid makse ei läinud läbi. Ostukorvi saad ühe klõpsuga uuesti täita.",
        introTopUp: "Alustasid krediidi laadimist, kuid makse ei läinud läbi. Saad jätkata oma krediitide juures.",
        orderLabel: "Tellimus",
        totalLabel: "Kokku",
        action: "Lõpeta ost",
        footer: "Saadame selle ainult korra, sest alustasid meie lehel makset.",
        settings: "Lülita need meeldetuletused välja",
    },
    fr: {
        subject: "Votre achat n’est pas encore terminé",
        heading: "Vous avez laissé quelque chose en route",
        introOrder: "Vous avez commencé une commande mais le paiement n’a pas abouti. Votre panier peut être rempli à nouveau en un clic.",
        introTopUp: "Vous avez commencé une recharge de crédits mais le paiement n’a pas abouti. Vous pouvez la reprendre depuis vos crédits.",
        orderLabel: "Commande",
        totalLabel: "Total",
        action: "Terminer l’achat",
        footer: "Nous l’envoyons une seule fois, parce que vous avez commencé un paiement sur notre site.",
        settings: "Désactiver ces rappels",
    },
    it: {
        subject: "Il tuo acquisto non è ancora concluso",
        heading: "Hai lasciato qualcosa in sospeso",
        introOrder: "Hai iniziato un ordine ma il pagamento non è andato a buon fine. Puoi riempire di nuovo il carrello con un clic.",
        introTopUp: "Hai iniziato una ricarica di crediti ma il pagamento non è andato a buon fine. Puoi riprenderla dai tuoi crediti.",
        orderLabel: "Ordine",
        totalLabel: "Totale",
        action: "Completa l’acquisto",
        footer: "Lo inviamo una sola volta, perché hai iniziato un pagamento sul nostro sito.",
        settings: "Disattiva questi promemoria",
    },
    pl: {
        subject: "Twój zakup nie został jeszcze dokończony",
        heading: "Coś zostało niedokończone",
        introOrder: "Rozpoczęto zamówienie, ale płatność nie doszła do skutku. Koszyk można wypełnić ponownie jednym kliknięciem.",
        introTopUp: "Rozpoczęto doładowanie kredytów, ale płatność nie doszła do skutku. Można do niego wrócić w swoich kredytach.",
        orderLabel: "Zamówienie",
        totalLabel: "Razem",
        action: "Dokończ zakup",
        footer: "Wysyłamy to tylko raz, ponieważ rozpoczęto płatność na naszej stronie.",
        settings: "Wyłącz te przypomnienia",
    },
    pt: {
        subject: "A sua compra ainda não terminou",
        heading: "Ficou algo por concluir",
        introOrder: "Você começou um pedido mas o pagamento não foi concluído. O seu carrinho pode ser preenchido de novo com um clique.",
        introTopUp: "Você começou uma recarga de créditos mas o pagamento não foi concluído. Pode retomá-la a partir dos seus créditos.",
        orderLabel: "Pedido",
        totalLabel: "Total",
        action: "Concluir a compra",
        footer: "Enviamos isto apenas uma vez, porque você começou um pagamento no nosso site.",
        settings: "Desativar estes lembretes",
    },
    ru: {
        subject: "Ваша покупка еще не завершена",
        heading: "Вы кое-что не закончили",
        introOrder: "Вы начали заказ, но оплата не прошла. Корзину можно заполнить снова одним нажатием.",
        introTopUp: "Вы начали пополнение кредитов, но оплата не прошла. Продолжить можно в разделе кредитов.",
        orderLabel: "Заказ",
        totalLabel: "Итого",
        action: "Завершить покупку",
        footer: "Мы отправляем это только один раз, потому что вы начали оплату на нашем сайте.",
        settings: "Отключить эти напоминания",
    },
    zh: {
        subject: "你的购买尚未完成",
        heading: "你还有未完成的购买",
        introOrder: "你开始了一笔订单，但付款没有完成。只需点击一下即可重新填好购物车。",
        introTopUp: "你开始了一次积分充值，但付款没有完成。你可以在积分页面继续。",
        orderLabel: "订单",
        totalLabel: "总计",
        action: "完成购买",
        footer: "因为你在我们网站上开始了付款，我们只发送这一次。",
        settings: "关闭这些提醒",
    },
};

function stringsFor(locale: string | null | undefined): ReminderStrings {
    return STRINGS[(locale ?? "en").slice(0, 2)] ?? STRINGS.en;
}

interface ReminderEmail {
    to: string;
    locale: string | null;
    kind: "order" | "topUp";
    /** The buyer-facing order number, for an order. */
    orderNumber: string | null;
    total: number;
    /** Where the buyer picks the checkout up again, as a path on this site. */
    resumePath: string;
}

/** Queues the reminder; the queue's own retries take it from there. */
export async function queueCheckoutReminder(input: ReminderEmail): Promise<void> {
    const t = stringsFor(input.locale);
    const base = resolveAppUrl();
    const resumeUrl = `${base}${input.resumePath}`;
    const settingsUrl = `${base}/profile?section=notifications`;
    const total = await formatSiteCurrency(input.total, input.locale ?? "en");
    const intro = input.kind === "order" ? t.introOrder : t.introTopUp;

    const lines = [t.heading, "", intro];
    if (input.orderNumber) lines.push(`${t.orderLabel}: ${input.orderNumber}`);
    lines.push(`${t.totalLabel}: ${total}`, "", `${t.action}: ${resumeUrl}`, "", t.footer, `${t.settings}: ${settingsUrl}`);

    const orderLine = input.orderNumber
        ? `<p style="margin: 0; color: #1f2937;"><strong>${escapeHtml(t.orderLabel)}:</strong> ${escapeHtml(input.orderNumber)}</p>`
        : "";
    const html = `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1f2937;">${escapeHtml(t.heading)}</h2>
                <p style="color: #6b7280;">${escapeHtml(intro)}</p>
                <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
                    ${orderLine}
                    <p style="margin: 4px 0 0; color: #1f2937;"><strong>${escapeHtml(t.totalLabel)}:</strong> ${escapeHtml(total)}</p>
                </div>
                <p><a href="${escapeHtml(resumeUrl)}" style="display: inline-block; background: #1f2937; color: #ffffff; padding: 10px 16px; border-radius: 6px; text-decoration: none;">${escapeHtml(t.action)}</a></p>
                <p style="color: #6b7280; font-size: 12px;">${escapeHtml(t.footer)} <a href="${escapeHtml(settingsUrl)}" style="color: #6b7280;">${escapeHtml(t.settings)}</a></p>
            </div>
        `;

    const id = await queueEmail({ to: input.to, subject: t.subject, body: lines.join("\n"), html });
    if (!id) {
        log.warn("[store] checkout reminder could not be queued", { kind: input.kind, orderNumber: input.orderNumber });
    }
}
