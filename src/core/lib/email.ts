import { prisma } from "./db";
import { resolveAppName, resolveAppUrl } from "./app-url";
import { getEmailConfig } from "./email-config";
import { resolveMailer } from "./mailer";
import { log } from "./logger";
import type { Locale } from "./i18n/config";

/**
 * Core email service.
 *
 * Two modes of use:
 *
 *   1. queueEmail({...}) - enqueue an EmailJob row and return immediately.
 *      A core cron (`core:process-email-queue`) drains the queue every
 *      5 minutes with exponential backoff. Use this for anything that
 *      does NOT need to be delivered before the HTTP response returns
 *      (broadcasts, welcome mails, receipts, etc.).
 *
 *   2. sendEmail({...}) - still synchronous for callers that MUST send
 *      immediately (password reset links, 2FA, email verification).
 *      Internally this still logs an EmailJob row for audit purposes
 *      so every outbound message is recorded in one place.
 *
 * When no provider is configured all functions degrade gracefully to
 * console.log - tests and dev don't need SMTP. The transport, the return
 * address and the sender name come from `email-config`, which reads the
 * admin's rows before the environment.
 */

// Runtime-resolved: NEXT_PUBLIC_* is inlined at build time and cannot
// differ per installation in the prebuilt image. See app-url.ts.
const APP_NAME = resolveAppName();
const MAX_ATTEMPTS = 3;

/**
 * How long a claim may sit before the queue assumes nobody is working on it.
 *
 * The job runs every five minutes and a send is a single HTTP call, so a row
 * still `sending` after fifteen belongs to a process that went away: a
 * deploy, a restart, the rebuild an install triggers. Nothing else recovers
 * one - the claim only looks for `pending` and the admin endpoint is
 * read-only - so a message claimed and interrupted was lost silently.
 */
const CLAIM_STALE_AFTER_MS = 15 * 60_000;

// Inline localized strings for transactional emails, one entry per locale
// the site ships. Kept here so emails don't depend on the next-intl request
// context (they're often sent from background jobs).
type EmailKey =
    | "resetSubject" | "resetHeading" | "resetIntro" | "resetCta" | "resetButton" | "resetIgnore"
    | "welcomeSubject" | "welcomeHeading" | "welcomeBody1" | "welcomeBody2"
    | "verifySubject" | "verifyHeading" | "verifyBody" | "verifyButton" | "verifyIgnore"
    | "emailChangeSubject" | "emailChangeHeading" | "emailChangeBody" | "emailChangeButton" | "emailChangeIgnore"
    | "emailChangeNoticeSubject" | "emailChangeNoticeHeading" | "emailChangeNoticeBody" | "emailChangeNoticeWarn"
    | "lockoutSubject" | "lockoutHeading" | "lockoutHi" | "lockoutIntro" | "lockoutUnlocks"
    | "lockoutWasYou" | "lockoutNotYou" | "lockoutFooter" | "lockoutIpLine";

const EMAIL_STRINGS: Record<Locale, Record<EmailKey, string>> = {
    en: {
        resetSubject: "Reset your {app} password",
        resetHeading: "Reset Your Password",
        resetIntro: "You requested a password reset for your {app} account.",
        resetCta: "Click the button below to set a new password. This link expires in 1 hour.",
        resetButton: "Reset Password",
        resetIgnore: "If you didn't request this, you can safely ignore this email.",
        welcomeSubject: "Welcome to {app}!",
        welcomeHeading: "Welcome, {username}!",
        welcomeBody1: "Your {app} account has been created successfully.",
        welcomeBody2: "Explore the platform and discover all available features.",
        emailChangeSubject: "Confirm your new {app} address",
        emailChangeHeading: "Confirm this address",
        emailChangeBody: "Somebody asked to move a {app} account to this address. The account keeps its old one until you confirm.",
        emailChangeButton: "Confirm this address",
        emailChangeIgnore: "If this was not you, ignore this message. Nothing has changed.",
        emailChangeNoticeSubject: "A new address was requested for your {app} account",
        emailChangeNoticeHeading: "Somebody asked to change your address",
        emailChangeNoticeBody: "A request was made to move your {app} account to {newEmail}. Your account still uses this address, and will keep it until that one is confirmed.",
        emailChangeNoticeWarn: "If this was not you, change your password now: whoever asked may be signed in as you.",
        verifySubject: "Verify your {app} email",
        verifyHeading: "Verify Your Email",
        verifyBody: "Click the button below to verify your email address.",
        verifyButton: "Verify Email",
        verifyIgnore: "If you didn't create an account, ignore this email.",
        lockoutSubject: "{app}: too many failed sign-in attempts",
        lockoutHeading: "Unusual sign-in activity",
        lockoutHi: "Hi {username},",
        lockoutIntro: "Someone made too many failed sign-in attempts on your {app} account. We've temporarily locked it as a safety measure.",
        lockoutUnlocks: "The account unlocks at:",
        lockoutWasYou: "If this was you, wait until the lock lifts and try again.",
        lockoutNotYou: "If this was NOT you, change your password as soon as the account unlocks - someone knows (or is guessing) part of your credentials.",
        lockoutFooter: "{app} security notification.",
        lockoutIpLine: "Attempts came from IP",
    },
    tr: {
        resetSubject: "{app} şifreni sıfırla",
        resetHeading: "Şifreni Sıfırla",
        resetIntro: "{app} hesabın için şifre sıfırlama isteğinde bulundun.",
        resetCta: "Yeni bir şifre belirlemek için aşağıdaki butona tıkla. Bağlantı 1 saat içinde geçerliliğini yitirir.",
        resetButton: "Şifreyi Sıfırla",
        resetIgnore: "Eğer bu isteği sen yapmadıysan, bu e-postayı yok sayabilirsin.",
        welcomeSubject: "{app}'e hoş geldin!",
        welcomeHeading: "Hoş geldin, {username}!",
        welcomeBody1: "{app} hesabın başarıyla oluşturuldu.",
        welcomeBody2: "Platformu keşfet ve tüm özellikleri kullanmaya başla.",
        emailChangeSubject: "Yeni {app} adresini onayla",
        emailChangeHeading: "Bu adresi onayla",
        emailChangeBody: "Bir {app} hesabının bu adrese taşınması istendi. Onaylayana kadar hesap eski adresinde kalır.",
        emailChangeButton: "Bu adresi onayla",
        emailChangeIgnore: "Bunu sen istemediysen bu iletiyi yok say. Hiçbir şey değişmedi.",
        emailChangeNoticeSubject: "{app} hesabın için yeni adres istendi",
        emailChangeNoticeHeading: "Adresini değiştirme isteği var",
        emailChangeNoticeBody: "{app} hesabının {newEmail} adresine taşınması istendi. Hesabın hâlâ bu adresi kullanıyor ve o adres onaylanana kadar da kullanacak.",
        emailChangeNoticeWarn: "Bunu sen istemediysen hemen parolanı değiştir: isteği yapan kişi senin hesabında oturum açmış olabilir.",
        verifySubject: "{app} e-postanı doğrula",
        verifyHeading: "E-postanı Doğrula",
        verifyBody: "E-posta adresini doğrulamak için aşağıdaki butona tıkla.",
        verifyButton: "E-postayı Doğrula",
        verifyIgnore: "Eğer bir hesap oluşturmadıysan, bu e-postayı yok say.",
        lockoutSubject: "{app}: çok fazla başarısız giriş denemesi",
        lockoutHeading: "Olağandışı giriş etkinliği",
        lockoutHi: "Merhaba {username},",
        lockoutIntro: "{app} hesabında çok fazla başarısız giriş denemesi yapıldı. Güvenlik önlemi olarak hesabını geçici olarak kilitledik.",
        lockoutUnlocks: "Hesabın şu zamanda açılacak:",
        lockoutWasYou: "Bu sendin ise, kilit kalkana kadar bekleyip tekrar dene.",
        lockoutNotYou: "Bu SEN DEĞİLSEN, hesabın açılır açılmaz şifreni değiştir - biri kimlik bilgilerinin bir kısmını biliyor (veya tahmin ediyor).",
        lockoutFooter: "{app} güvenlik bildirimi.",
        lockoutIpLine: "Denemeler şu IP'den geldi:",
    },
    az: {
        resetSubject: "{app} parolunuzu sıfırlayın",
        resetHeading: "Parolunuzu sıfırlayın",
        resetIntro: "{app} hesabınız üçün parol sıfırlanmasını tələb etdiniz.",
        resetCta: "Yeni parol təyin etmək üçün aşağıdakı düyməyə klikləyin. Bu keçid 1 saat ərzində bitir.",
        resetButton: "Parolu sıfırla",
        resetIgnore: "Bunu siz tələb etmədinizsə, bu e-poçtu nəzərə almaya bilərsiniz.",
        welcomeSubject: "{app} platformasına xoş gəlmisiniz!",
        welcomeHeading: "Xoş gəlmisiniz, {username}!",
        welcomeBody1: "{app} hesabınız uğurla yaradıldı.",
        welcomeBody2: "Platformanı araşdırın və mövcud bütün imkanları kəşf edin.",
        emailChangeSubject: "{app} üçün yeni ünvanınızı təsdiqləyin",
        emailChangeHeading: "Bu ünvanı təsdiqləyin",
        emailChangeBody: "Kimsə {app} hesabını bu ünvana köçürmək istəyib. Siz təsdiqləyənə qədər hesab köhnə ünvanını saxlayır.",
        emailChangeButton: "Bu ünvanı təsdiqlə",
        emailChangeIgnore: "Bunu siz etməmisinizsə, bu mesaja fikir verməyin. Heç nə dəyişməyib.",
        emailChangeNoticeSubject: "{app} hesabınız üçün yeni ünvan tələb olundu",
        emailChangeNoticeHeading: "Kimsə ünvanınızı dəyişmək istəyib",
        emailChangeNoticeBody: "{app} hesabınızı {newEmail} ünvanına köçürmək üçün sorğu göndərilib. Hesabınız hələ də bu ünvanı istifadə edir və yeni ünvan təsdiqlənənə qədər onu saxlayacaq.",
        emailChangeNoticeWarn: "Bunu siz etməmisinizsə, indi parolunuzu dəyişin: sorğunu göndərən şəxs sizin adınızla daxil ola bilər.",
        verifySubject: "{app} e-poçtunuzu təsdiqləyin",
        verifyHeading: "E-poçtunuzu təsdiqləyin",
        verifyBody: "E-poçt ünvanınızı təsdiqləmək üçün aşağıdakı düyməyə klikləyin.",
        verifyButton: "E-poçtu təsdiqlə",
        verifyIgnore: "Hesab yaratmamısınızsa, bu e-poçtu nəzərə almayın.",
        lockoutSubject: "{app}: çoxlu uğursuz giriş cəhdi",
        lockoutHeading: "Qeyri-adi giriş fəaliyyəti",
        lockoutHi: "Salam, {username},",
        lockoutIntro: "Kimsə {app} hesabınıza çoxlu uğursuz giriş cəhdi edib. Təhlükəsizlik tədbiri olaraq hesabı müvəqqəti kilidləmişik.",
        lockoutUnlocks: "Hesabın kilidi açılacaq:",
        lockoutWasYou: "Bunu siz etmisinizsə, kilid açılana qədər gözləyin və yenidən cəhd edin.",
        lockoutNotYou: "Bunu siz etməmisinizsə, hesabın kilidi açılan kimi parolunuzu dəyişin - kimsə etimadnamələrinizin bir hissəsini bilir (və ya təxmin edir).",
        lockoutFooter: "{app} təhlükəsizlik bildirişi.",
        lockoutIpLine: "Cəhdlər bu IP ünvanından gəlib",
    },
    de: {
        resetSubject: "Setze dein Passwort für {app} zurück",
        resetHeading: "Passwort zurücksetzen",
        resetIntro: "Du hast ein Zurücksetzen des Passworts für dein {app}-Konto angefordert.",
        resetCta: "Klicke unten auf den Button, um ein neues Passwort festzulegen. Dieser Link läuft in 1 Stunde ab.",
        resetButton: "Passwort zurücksetzen",
        resetIgnore: "Falls du das nicht angefordert hast, kannst du diese E-Mail einfach ignorieren.",
        welcomeSubject: "Willkommen bei {app}!",
        welcomeHeading: "Willkommen, {username}!",
        welcomeBody1: "Dein {app}-Konto wurde erfolgreich erstellt.",
        welcomeBody2: "Entdecke die Plattform und alle verfügbaren Funktionen.",
        emailChangeSubject: "Bestätige deine neue Adresse für {app}",
        emailChangeHeading: "Diese Adresse bestätigen",
        emailChangeBody: "Jemand hat darum gebeten, ein {app}-Konto auf diese Adresse umzuziehen. Das Konto behält bis zu deiner Bestätigung die alte Adresse.",
        emailChangeButton: "Diese Adresse bestätigen",
        emailChangeIgnore: "Falls du das nicht warst, ignoriere diese Nachricht. Es hat sich nichts geändert.",
        emailChangeNoticeSubject: "Für dein {app}-Konto wurde eine neue Adresse angefordert",
        emailChangeNoticeHeading: "Jemand hat um die Änderung deiner Adresse gebeten",
        emailChangeNoticeBody: "Es wurde beantragt, dein {app}-Konto auf {newEmail} umzuziehen. Dein Konto nutzt weiterhin diese Adresse und behält sie, bis die neue bestätigt ist.",
        emailChangeNoticeWarn: "Falls du das nicht warst, ändere jetzt dein Passwort: Wer das angefordert hat, könnte als du angemeldet sein.",
        verifySubject: "Bestätige deine E-Mail-Adresse für {app}",
        verifyHeading: "E-Mail-Adresse bestätigen",
        verifyBody: "Klicke unten auf den Button, um deine E-Mail-Adresse zu bestätigen.",
        verifyButton: "E-Mail bestätigen",
        verifyIgnore: "Falls du kein Konto erstellt hast, ignoriere diese E-Mail.",
        lockoutSubject: "{app}: zu viele fehlgeschlagene Anmeldeversuche",
        lockoutHeading: "Ungewöhnliche Anmeldeaktivität",
        lockoutHi: "Hallo {username},",
        lockoutIntro: "Bei deinem {app}-Konto gab es zu viele fehlgeschlagene Anmeldeversuche. Als Schutzmaßnahme haben wir es vorübergehend gesperrt.",
        lockoutUnlocks: "Das Konto wird entsperrt um:",
        lockoutWasYou: "Warst du das, warte, bis die Sperre aufgehoben ist, und versuche es dann erneut.",
        lockoutNotYou: "Warst du das NICHT, ändere dein Passwort, sobald das Konto entsperrt ist: Jemand kennt (oder errät) einen Teil deiner Zugangsdaten.",
        lockoutFooter: "Sicherheitshinweis von {app}.",
        lockoutIpLine: "Die Versuche kamen von der IP-Adresse",
    },
    es: {
        resetSubject: "Restablece tu contraseña de {app}",
        resetHeading: "Restablece tu contraseña",
        resetIntro: "Has solicitado restablecer la contraseña de tu cuenta de {app}.",
        resetCta: "Haz clic en el botón de abajo para establecer una nueva contraseña. Este enlace caduca en 1 hora.",
        resetButton: "Restablecer contraseña",
        resetIgnore: "Si no lo has solicitado tú, puedes ignorar este correo sin problema.",
        welcomeSubject: "¡Bienvenido a {app}!",
        welcomeHeading: "¡Bienvenido, {username}!",
        welcomeBody1: "Tu cuenta de {app} se ha creado correctamente.",
        welcomeBody2: "Explora la plataforma y descubre todas las funciones disponibles.",
        emailChangeSubject: "Confirma tu nueva dirección de correo de {app}",
        emailChangeHeading: "Confirma esta dirección",
        emailChangeBody: "Alguien ha pedido trasladar una cuenta de {app} a esta dirección. La cuenta conserva la anterior hasta que confirmes la nueva.",
        emailChangeButton: "Confirmar esta dirección",
        emailChangeIgnore: "Si no has sido tú, ignora este mensaje. No se ha cambiado nada.",
        emailChangeNoticeSubject: "Se ha solicitado una nueva dirección para tu cuenta de {app}",
        emailChangeNoticeHeading: "Alguien ha pedido cambiar tu dirección",
        emailChangeNoticeBody: "Se ha solicitado trasladar tu cuenta de {app} a {newEmail}. Tu cuenta sigue usando tu dirección actual y la conservará hasta que se confirme la nueva.",
        emailChangeNoticeWarn: "Si no has sido tú, cambia tu contraseña ahora: quien lo pidió podría tener la sesión iniciada como tú.",
        verifySubject: "Verifica tu correo de {app}",
        verifyHeading: "Verifica tu correo",
        verifyBody: "Haz clic en el botón de abajo para verificar tu dirección de correo.",
        verifyButton: "Verificar correo",
        verifyIgnore: "Si no has creado una cuenta, ignora este correo.",
        lockoutSubject: "{app}: demasiados intentos fallidos de inicio de sesión",
        lockoutHeading: "Actividad de inicio de sesión inusual",
        lockoutHi: "Hola, {username}:",
        lockoutIntro: "Alguien ha hecho demasiados intentos fallidos de inicio de sesión en tu cuenta de {app}. Por seguridad, la hemos bloqueado temporalmente.",
        lockoutUnlocks: "La cuenta se desbloqueará a las:",
        lockoutWasYou: "Si has sido tú, espera a que termine el bloqueo y vuelve a intentarlo.",
        lockoutNotYou: "Si NO has sido tú, cambia tu contraseña en cuanto se desbloquee la cuenta: alguien conoce (o está adivinando) parte de tus credenciales.",
        lockoutFooter: "Notificación de seguridad de {app}.",
        lockoutIpLine: "Los intentos llegaron desde la IP",
    },
    et: {
        resetSubject: "Lähtesta oma {app} parool",
        resetHeading: "Lähtesta oma parool",
        resetIntro: "Taotlesid oma {app} konto parooli lähtestamist.",
        resetCta: "Uue parooli määramiseks klõpsa allolevat nuppu. See link aegub 1 tunni pärast.",
        resetButton: "Lähtesta parool",
        resetIgnore: "Kui sa seda ei taotlenud, võid selle kirja turvaliselt ignoreerida.",
        welcomeSubject: "Tere tulemast {app} kasutajaks!",
        welcomeHeading: "Tere tulemast, {username}!",
        welcomeBody1: "Sinu {app} konto on edukalt loodud.",
        welcomeBody2: "Tutvu platvormiga ja avasta kõik saadaolevad funktsioonid.",
        emailChangeSubject: "Kinnita oma uus {app} aadress",
        emailChangeHeading: "Kinnita see aadress",
        emailChangeBody: "Keegi palus viia {app} konto sellele aadressile. Konto kasutab vana aadressi, kuni sa uue kinnitad.",
        emailChangeButton: "Kinnita see aadress",
        emailChangeIgnore: "Kui see polnud sina, ignoreeri seda kirja. Midagi pole muutunud.",
        emailChangeNoticeSubject: "Sinu {app} konto jaoks taotleti uut aadressi",
        emailChangeNoticeHeading: "Keegi palus sinu aadressi muuta",
        emailChangeNoticeBody: "Taotleti sinu {app} konto viimist aadressile {newEmail}. Sinu konto kasutab endiselt seda aadressi ja jätkab selle kasutamist, kuni uus aadress on kinnitatud.",
        emailChangeNoticeWarn: "Kui see polnud sina, muuda kohe oma parooli: taotleja võib olla sinu nimel sisse logitud.",
        verifySubject: "Kinnita oma {app} e-post",
        verifyHeading: "Kinnita oma e-post",
        verifyBody: "Kinnitamiseks klõpsa allolevat nuppu.",
        verifyButton: "Kinnita e-post",
        verifyIgnore: "Kui sa kontot ei loonud, ignoreeri seda kirja.",
        lockoutSubject: "{app}: liiga palju ebaõnnestunud sisselogimiskatseid",
        lockoutHeading: "Ebatavaline sisselogimistegevus",
        lockoutHi: "Tere, {username},",
        lockoutIntro: "Keegi tegi sinu {app} kontole liiga palju ebaõnnestunud sisselogimiskatseid. Turvameetmena oleme konto ajutiselt lukustanud.",
        lockoutUnlocks: "Konto avaneb:",
        lockoutWasYou: "Kui see olid sina, oota, kuni lukustus lõpeb, ja proovi uuesti.",
        lockoutNotYou: "Kui see EI olnud sina, muuda parooli kohe, kui konto avaneb. Keegi teab (või arvab) osa sinu andmetest.",
        lockoutFooter: "{app} turvateade.",
        lockoutIpLine: "Katsed tulid IP-aadressilt",
    },
    fr: {
        resetSubject: "Réinitialisez votre mot de passe {app}",
        resetHeading: "Réinitialiser votre mot de passe",
        resetIntro: "Vous avez demandé la réinitialisation du mot de passe de votre compte {app}.",
        resetCta: "Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe. Ce lien expire dans 1 heure.",
        resetButton: "Réinitialiser le mot de passe",
        resetIgnore: "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.",
        welcomeSubject: "Bienvenue sur {app} !",
        welcomeHeading: "Bienvenue, {username} !",
        welcomeBody1: "Votre compte {app} a été créé avec succès.",
        welcomeBody2: "Explorez la plateforme et découvrez toutes les fonctionnalités disponibles.",
        emailChangeSubject: "Confirmez votre nouvelle adresse {app}",
        emailChangeHeading: "Confirmer cette adresse",
        emailChangeBody: "Quelqu’un a demandé à associer un compte {app} à cette adresse. Le compte conserve son ancienne adresse tant que vous ne l’avez pas confirmée.",
        emailChangeButton: "Confirmer cette adresse",
        emailChangeIgnore: "Si ce n’est pas vous, ignorez ce message. Rien n’a changé.",
        emailChangeNoticeSubject: "Une nouvelle adresse a été demandée pour votre compte {app}",
        emailChangeNoticeHeading: "Quelqu’un a demandé à modifier votre adresse",
        emailChangeNoticeBody: "Une demande a été faite pour associer votre compte {app} à {newEmail}. Votre compte utilise toujours votre adresse actuelle et la conservera tant que la nouvelle n’est pas confirmée.",
        emailChangeNoticeWarn: "Si ce n’est pas vous, changez votre mot de passe dès maintenant : la personne à l’origine de la demande peut être connectée à votre compte.",
        verifySubject: "Vérifiez votre adresse e-mail {app}",
        verifyHeading: "Vérifiez votre adresse e-mail",
        verifyBody: "Cliquez sur le bouton ci-dessous pour vérifier votre adresse e-mail.",
        verifyButton: "Vérifier l’e-mail",
        verifyIgnore: "Si vous n’avez pas créé de compte, ignorez cet e-mail.",
        lockoutSubject: "{app} : trop de tentatives de connexion échouées",
        lockoutHeading: "Activité de connexion inhabituelle",
        lockoutHi: "Bonjour {username},",
        lockoutIntro: "Trop de tentatives de connexion échouées ont été effectuées sur votre compte {app}. Nous l’avons verrouillé temporairement par mesure de sécurité.",
        lockoutUnlocks: "Le compte sera déverrouillé à :",
        lockoutWasYou: "Si c’était vous, attendez la fin du verrouillage et réessayez.",
        lockoutNotYou: "Si ce n’était PAS vous, changez votre mot de passe dès que le compte sera déverrouillé : quelqu’un connaît (ou devine) une partie de vos identifiants.",
        lockoutFooter: "Notification de sécurité {app}.",
        lockoutIpLine: "Les tentatives provenaient de l’adresse IP",
    },
    it: {
        resetSubject: "Reimposta la tua password di {app}",
        resetHeading: "Reimposta la tua password",
        resetIntro: "Hai richiesto il reset della password per il tuo account {app}.",
        resetCta: "Clicca il pulsante qui sotto per impostare una nuova password. Questo link scade tra 1 ora.",
        resetButton: "Reimposta password",
        resetIgnore: "Se non sei stato tu a fare questa richiesta, puoi ignorare questa email.",
        welcomeSubject: "Benvenuto in {app}!",
        welcomeHeading: "Benvenuto, {username}!",
        welcomeBody1: "Il tuo account {app} è stato creato con successo.",
        welcomeBody2: "Esplora la piattaforma e scopri tutte le funzionalità disponibili.",
        emailChangeSubject: "Conferma il tuo nuovo indirizzo di {app}",
        emailChangeHeading: "Conferma questo indirizzo",
        emailChangeBody: "Qualcuno ha chiesto di spostare un account {app} su questo indirizzo. L’account mantiene quello vecchio finché non confermi.",
        emailChangeButton: "Conferma questo indirizzo",
        emailChangeIgnore: "Se non sei stato tu, ignora questo messaggio. Non è cambiato nulla.",
        emailChangeNoticeSubject: "È stato richiesto un nuovo indirizzo per il tuo account {app}",
        emailChangeNoticeHeading: "Qualcuno ha chiesto di cambiare il tuo indirizzo",
        emailChangeNoticeBody: "È stata fatta una richiesta per spostare il tuo account {app} su {newEmail}. Il tuo account usa ancora questo indirizzo e lo userà finché quello nuovo non sarà confermato.",
        emailChangeNoticeWarn: "Se non sei stato tu, cambia subito la password: chi ha fatto la richiesta potrebbe accedere come te.",
        verifySubject: "Verifica la tua email di {app}",
        verifyHeading: "Verifica la tua email",
        verifyBody: "Clicca il pulsante qui sotto per verificare il tuo indirizzo email.",
        verifyButton: "Verifica email",
        verifyIgnore: "Se non hai creato tu un account, ignora questa email.",
        lockoutSubject: "{app}: troppi tentativi di accesso falliti",
        lockoutHeading: "Attività di accesso insolita",
        lockoutHi: "Ciao {username},",
        lockoutIntro: "Qualcuno ha fatto troppi tentativi di accesso falliti sul tuo account {app}. Per sicurezza, lo abbiamo bloccato temporaneamente.",
        lockoutUnlocks: "L’account si sbloccherà alle:",
        lockoutWasYou: "Se sei stato tu, aspetta che il blocco venga rimosso e riprova.",
        lockoutNotYou: "Se NON sei stato tu, cambia la password appena l’account si sblocca: qualcuno conosce (o sta indovinando) parte delle tue credenziali.",
        lockoutFooter: "Notifica di sicurezza di {app}.",
        lockoutIpLine: "I tentativi provenivano dall’IP",
    },
    pl: {
        resetSubject: "Zresetuj hasło do {app}",
        resetHeading: "Zresetuj swoje hasło",
        resetIntro: "Poprosiłeś o reset hasła do konta w {app}.",
        resetCta: "Kliknij przycisk poniżej, aby ustawić nowe hasło. Ten link wygasa za 1 godzinę.",
        resetButton: "Zresetuj hasło",
        resetIgnore: "Jeśli to nie Ty o to poprosiłeś, możesz bezpiecznie zignorować tę wiadomość.",
        welcomeSubject: "Witaj w {app}!",
        welcomeHeading: "Witaj, {username}!",
        welcomeBody1: "Twoje konto w {app} zostało pomyślnie utworzone.",
        welcomeBody2: "Poznaj platformę i odkryj wszystkie dostępne funkcje.",
        emailChangeSubject: "Potwierdź swój nowy adres w {app}",
        emailChangeHeading: "Potwierdź ten adres",
        emailChangeBody: "Ktoś poprosił o przeniesienie konta w {app} na ten adres. Konto zachowuje dotychczasowy adres, dopóki go nie potwierdzisz.",
        emailChangeButton: "Potwierdź ten adres",
        emailChangeIgnore: "Jeśli to nie Ty, zignoruj tę wiadomość. Nic się nie zmieniło.",
        emailChangeNoticeSubject: "Zgłoszono prośbę o nowy adres dla Twojego konta w {app}",
        emailChangeNoticeHeading: "Ktoś poprosił o zmianę Twojego adresu",
        emailChangeNoticeBody: "Złożono prośbę o przeniesienie Twojego konta w {app} na {newEmail}. Konto nadal używa tego adresu i będzie go używać, dopóki nowy nie zostanie potwierdzony.",
        emailChangeNoticeWarn: "Jeśli to nie Ty, zmień teraz hasło: osoba, która o to poprosiła, może być zalogowana jako Ty.",
        verifySubject: "Zweryfikuj swój e-mail w {app}",
        verifyHeading: "Zweryfikuj swój e-mail",
        verifyBody: "Kliknij przycisk poniżej, aby zweryfikować swój adres e-mail.",
        verifyButton: "Zweryfikuj e-mail",
        verifyIgnore: "Jeśli nie zakładałeś konta, zignoruj tę wiadomość.",
        lockoutSubject: "{app}: zbyt wiele nieudanych prób logowania",
        lockoutHeading: "Nietypowa aktywność logowania",
        lockoutHi: "Cześć {username},",
        lockoutIntro: "Ktoś wykonał zbyt wiele nieudanych prób logowania na Twoim koncie w {app}. Tymczasowo je zablokowaliśmy jako środek bezpieczeństwa.",
        lockoutUnlocks: "Konto zostanie odblokowane o:",
        lockoutWasYou: "Jeśli to Ty, poczekaj, aż blokada minie, i spróbuj ponownie.",
        lockoutNotYou: "Jeśli to NIE Ty, zmień hasło zaraz po odblokowaniu konta. Ktoś zna (albo zgaduje) część Twoich danych logowania.",
        lockoutFooter: "Powiadomienie o bezpieczeństwie {app}.",
        lockoutIpLine: "Próby pochodziły z adresu IP",
    },
    pt: {
        resetSubject: "Redefina sua senha do {app}",
        resetHeading: "Redefinir sua senha",
        resetIntro: "Você solicitou a redefinição de senha da sua conta no {app}.",
        resetCta: "Clique no botão abaixo para definir uma nova senha. Este link expira em 1 hora.",
        resetButton: "Redefinir senha",
        resetIgnore: "Se você não solicitou isso, pode ignorar este e-mail com tranquilidade.",
        welcomeSubject: "Bem-vindo ao {app}!",
        welcomeHeading: "Bem-vindo, {username}!",
        welcomeBody1: "Sua conta no {app} foi criada com sucesso.",
        welcomeBody2: "Explore a plataforma e descubra todos os recursos disponíveis.",
        emailChangeSubject: "Confirme seu novo endereço no {app}",
        emailChangeHeading: "Confirme este endereço",
        emailChangeBody: "Alguém pediu para mudar uma conta do {app} para este endereço. A conta mantém o endereço antigo até que você confirme.",
        emailChangeButton: "Confirmar este endereço",
        emailChangeIgnore: "Se não foi você, ignore esta mensagem. Nada foi alterado.",
        emailChangeNoticeSubject: "Foi solicitado um novo endereço para a sua conta no {app}",
        emailChangeNoticeHeading: "Alguém pediu para alterar o seu endereço",
        emailChangeNoticeBody: "Foi feito um pedido para mudar a sua conta do {app} para {newEmail}. A conta continua usando este endereço e vai mantê-lo até que o novo seja confirmado.",
        emailChangeNoticeWarn: "Se não foi você, altere sua senha agora: quem fez o pedido pode estar conectado como você.",
        verifySubject: "Confirme seu e-mail do {app}",
        verifyHeading: "Confirme seu e-mail",
        verifyBody: "Clique no botão abaixo para confirmar seu endereço de e-mail.",
        verifyButton: "Confirmar e-mail",
        verifyIgnore: "Se você não criou uma conta, pode ignorar este e-mail.",
        lockoutSubject: "{app}: muitas tentativas de login sem sucesso",
        lockoutHeading: "Atividade de login incomum",
        lockoutHi: "Olá, {username},",
        lockoutIntro: "Houve muitas tentativas de login sem sucesso na sua conta do {app}. Por segurança, ela foi bloqueada temporariamente.",
        lockoutUnlocks: "A conta será desbloqueada em:",
        lockoutWasYou: "Se foi você, aguarde o fim do bloqueio e tente novamente.",
        lockoutNotYou: "Se NÃO foi você, altere sua senha assim que a conta for desbloqueada: alguém conhece (ou está tentando adivinhar) parte das suas credenciais.",
        lockoutFooter: "Notificação de segurança do {app}.",
        lockoutIpLine: "As tentativas vieram do IP",
    },
    ru: {
        resetSubject: "Сброс пароля для {app}",
        resetHeading: "Сброс пароля",
        resetIntro: "Вы запросили сброс пароля для своей учетной записи в {app}.",
        resetCta: "Нажмите кнопку ниже, чтобы задать новый пароль. Срок действия этой ссылки истекает через 1 час.",
        resetButton: "Сбросить пароль",
        resetIgnore: "Если вы не запрашивали это, можете просто проигнорировать это письмо.",
        welcomeSubject: "Добро пожаловать в {app}!",
        welcomeHeading: "Добро пожаловать, {username}!",
        welcomeBody1: "Ваша учетная запись в {app} успешно создана.",
        welcomeBody2: "Изучите платформу и откройте для себя все доступные возможности.",
        emailChangeSubject: "Подтвердите новый адрес для {app}",
        emailChangeHeading: "Подтвердите этот адрес",
        emailChangeBody: "Кто-то запросил перенос учетной записи {app} на этот адрес. До вашего подтверждения учетная запись сохраняет прежний адрес.",
        emailChangeButton: "Подтвердить этот адрес",
        emailChangeIgnore: "Если это были не вы, проигнорируйте это сообщение. Ничего не изменилось.",
        emailChangeNoticeSubject: "Для вашей учетной записи в {app} запрошен новый адрес",
        emailChangeNoticeHeading: "Кто-то запросил смену вашего адреса",
        emailChangeNoticeBody: "Поступил запрос на перенос вашей учетной записи {app} на адрес {newEmail}. Учетная запись по-прежнему использует текущий адрес и будет использовать его, пока новый адрес не будет подтвержден.",
        emailChangeNoticeWarn: "Если это были не вы, немедленно смените пароль: тот, кто сделал запрос, может войти в систему под вашим именем.",
        verifySubject: "Подтвердите ваш e-mail в {app}",
        verifyHeading: "Подтвердите ваш e-mail",
        verifyBody: "Нажмите кнопку ниже, чтобы подтвердить ваш адрес e-mail.",
        verifyButton: "Подтвердить e-mail",
        verifyIgnore: "Если вы не создавали учетную запись, проигнорируйте это письмо.",
        lockoutSubject: "{app}: слишком много неудачных попыток входа",
        lockoutHeading: "Необычная активность при входе",
        lockoutHi: "Здравствуйте, {username},",
        lockoutIntro: "Было сделано слишком много неудачных попыток входа в вашу учетную запись в {app}. В целях безопасности мы временно ее заблокировали.",
        lockoutUnlocks: "Учетная запись будет разблокирована:",
        lockoutWasYou: "Если это были вы, дождитесь окончания блокировки и попробуйте снова.",
        lockoutNotYou: "Если это были НЕ вы, смените пароль сразу после разблокировки учетной записи: кто-то знает (или подбирает) часть ваших данных для входа.",
        lockoutFooter: "Уведомление о безопасности {app}.",
        lockoutIpLine: "Попытки были сделаны с IP-адреса",
    },
    zh: {
        resetSubject: "重置你的 {app} 密码",
        resetHeading: "重置你的密码",
        resetIntro: "你已为你的 {app} 账户申请重置密码。",
        resetCta: "点击下方按钮设置新密码。此链接将在 1 小时后失效。",
        resetButton: "重置密码",
        resetIgnore: "如果这不是你本人的操作，可以放心忽略此邮件。",
        welcomeSubject: "欢迎加入 {app}！",
        welcomeHeading: "欢迎，{username}！",
        welcomeBody1: "你的 {app} 账户已成功创建。",
        welcomeBody2: "探索平台，了解所有可用功能。",
        emailChangeSubject: "确认你的新 {app} 邮箱地址",
        emailChangeHeading: "确认此邮箱地址",
        emailChangeBody: "有人请求将一个 {app} 账户迁移到此邮箱地址。在你确认之前，该账户仍保留原邮箱地址。",
        emailChangeButton: "确认此邮箱地址",
        emailChangeIgnore: "如果这不是你本人的操作，请忽略此邮件，账户没有任何变化。",
        emailChangeNoticeSubject: "你的 {app} 账户已有新邮箱地址更改请求",
        emailChangeNoticeHeading: "有人请求更改你的邮箱地址",
        emailChangeNoticeBody: "有人请求将你的 {app} 账户迁移到 {newEmail}。在新地址确认之前，你的账户仍将使用当前邮箱地址。",
        emailChangeNoticeWarn: "如果这不是你本人的操作，请立即更改密码：请求者可能已以你的身份登录。",
        verifySubject: "验证你的 {app} 邮箱",
        verifyHeading: "验证你的邮箱",
        verifyBody: "点击下方按钮验证你的邮箱地址。",
        verifyButton: "验证邮箱",
        verifyIgnore: "如果你并未创建账户，请忽略此邮件。",
        lockoutSubject: "{app}：登录失败次数过多",
        lockoutHeading: "异常登录活动",
        lockoutHi: "你好，{username}：",
        lockoutIntro: "有人在你的 {app} 账户上多次登录失败。出于安全考虑，我们已暂时锁定该账户。",
        lockoutUnlocks: "账户解锁时间：",
        lockoutWasYou: "如果是你本人操作，请等待锁定解除后再重试。",
        lockoutNotYou: "如果这不是你本人的操作，请在账户解锁后立即更改密码，因为有人已知晓（或正在猜测）你的部分登录凭据。",
        lockoutFooter: "{app} 安全通知。",
        lockoutIpLine: "登录尝试来自 IP",
    },
};

function emailT(locale: string | undefined, key: EmailKey, vars: Record<string, string> = {}): string {
    const dict = EMAIL_STRINGS[locale as Locale] ?? EMAIL_STRINGS.en;
    let s = dict[key];
    s = s.replace(/\{app\}/g, APP_NAME);
    for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
    return s;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Strip CR / LF / NUL from a value before it can reach an SMTP header.
 * Without this, a malicious `subject` field like "Hi\r\nBcc: me@example.com"
 * lets an attacker inject arbitrary recipients - the classic SMTP header
 * injection. Some transports normalize most of this on the way out; core
 * cannot know which, and the edge is the only place the invariant holds
 * whatever is installed.
 */
function stripHeaderInjection(value: string, maxLen = 998): string {
    if (typeof value !== "string") return "";
    return value
        // Any bare CR, LF, or NUL byte is rejected outright.
        .replace(/[\r\n\0]+/g, " ")
        // Long header fields may be folded by the provider in ways that
        // re-introduce control chars; clamp length to the RFC 5322 limit.
        .slice(0, maxLen)
        .trim();
}

function validateEmailAddress(addr: string): boolean {
    if (!addr || typeof addr !== "string") return false;
    if (/[\r\n\0,<>"]/.test(addr)) return false;
    if (addr.length > 254) return false;
    // Minimal shape check - provider does the heavy lifting.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Whether anything installed here can send.
 *
 * This used to ask whether a mail API key was set, which was the same
 * question only while there was one way to send mail. A transport with a
 * host and a password has no API key and was mail this site could not send.
 */
async function getEmailEnabled(): Promise<boolean> {
    return (await resolveMailer()) !== null;
}

/**
 * Low-level provider call. Does NOT touch the EmailJob row - callers are
 * responsible for status bookkeeping. Returns true on success.
 */
async function deliverViaProvider(opts: {
    to: string;
    subject: string;
    html: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    // Refuse malformed/malicious recipient and subject fields BEFORE they
    // reach the provider so a user-derived value can't turn into an SMTP
    // header injection.
    if (!validateEmailAddress(opts.to)) {
        return { ok: false, error: "Invalid recipient address" };
    }

    // The one place every outbound message passes through, so the one place
    // the email filters can run. They run before sanitization, not after: a
    // listener's output is no more trusted than a caller's, and the header
    // injection guard below has to be the last word on what is sent.
    let subject = opts.subject;
    let html = opts.html;
    try {
        const { applyFiltersAsync } = await import("./hooks");
        subject = await applyFiltersAsync("email.subject", opts.subject, { to: opts.to });
        html = await applyFiltersAsync("email.body", opts.html, { to: opts.to, subject });
    } catch {
        // A broken listener must not stop the mail. Fall back to what the
        // caller wrote.
        subject = opts.subject;
        html = opts.html;
    }

    const safeSubject = stripHeaderInjection(subject);
    if (!safeSubject) {
        return { ok: false, error: "Empty subject after sanitization" };
    }

    if (!(await getEmailEnabled())) {
        log.warn("email suppressed: no transport configured", { to: opts.to, subject: safeSubject });
        return { ok: true }; // Treat as delivered (dev/test mode)
    }
    const mailer = await resolveMailer();
    if (!mailer) return { ok: false, error: "No mail transport is configured" };
    try {
        const { fromEmail, fromName } = await getEmailConfig();
        await mailer.send({
            from: `${stripHeaderInjection(fromName ?? APP_NAME)} <${stripHeaderInjection(fromEmail)}>`,
            to: opts.to,
            subject: safeSubject,
            html,
        });
        return { ok: true };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error("[email] delivery failed:", error);
        return { ok: false, error };
    }
}

// ---------------------------------------------------------------------------
// Queue API
// ---------------------------------------------------------------------------

export interface QueueEmailInput {
    to: string;
    subject: string;
    /** Plain-text body - stored in EmailJob.body for audit. */
    body: string;
    /** Optional HTML body. If omitted, `body` is rendered as-is. */
    html?: string;
    /** Delay delivery until this time. Defaults to "now". */
    scheduleFor?: Date;
}

/**
 * Enqueue an email for background delivery. Returns the EmailJob id
 * (or null if DB insert failed). Always non-blocking and non-throwing.
 */
export async function queueEmail(input: QueueEmailInput): Promise<string | null> {
    try {
        const job = await prisma.emailJob.create({
            data: {
                to: input.to,
                subject: input.subject,
                body: input.body,
                html: input.html ?? null,
                status: "pending",
                scheduledAt: input.scheduleFor ?? new Date(),
            },
        });
        return job.id;
    } catch (err) {
        console.error("[email] queueEmail failed:", err);
        return null;
    }
}

/**
 * Drain up to `batchSize` pending jobs whose scheduledAt <= now.
 * Each job is marked `sending` before delivery to avoid duplicate sends
 * if two workers race; on failure it either retries (attempts < 3)
 * with exponential backoff or is marked `failed`.
 *
 * Safe to call from a cron, an admin endpoint, or tests.
 */
export async function processEmailQueue(batchSize = 10): Promise<{
    processed: number;
    sent: number;
    failed: number;
    retried: number;
}> {
    const now = new Date();
    let sent = 0;
    let failed = 0;
    let retried = 0;

    // Take back anything a dead process was holding. `EmailJob` carries no
    // `updatedAt` and does not need one: a `sending` row's `scheduledAt` has
    // no other meaning, so the claim below stamps it and a row still sending
    // long after its stamp is one nobody is working on. The attempt is
    // counted, so a row that keeps being interrupted reaches MAX_ATTEMPTS and
    // becomes visible as failed rather than cycling forever.
    await prisma.emailJob.updateMany({
        where: {
            status: "sending",
            scheduledAt: { lt: new Date(now.getTime() - CLAIM_STALE_AFTER_MS) },
        },
        data: {
            status: "pending",
            attempts: { increment: 1 },
            lastError: "Interrupted before the send completed",
        },
    });

    // Claim a batch. We use updateMany → findMany to mark as "sending"
    // atomically-enough for our scale; for strict exactly-once a SELECT
    // FOR UPDATE / advisory-lock pattern would be stronger.
    const pending = await prisma.emailJob.findMany({
        where: { status: "pending", scheduledAt: { lte: now } },
        orderBy: { scheduledAt: "asc" },
        take: batchSize,
    });

    if (pending.length === 0) {
        return { processed: 0, sent: 0, failed: 0, retried: 0 };
    }

    const claimed = await prisma.emailJob.updateMany({
        where: {
            id: { in: pending.map((j) => j.id) },
            status: "pending",
        },
        data: { status: "sending", scheduledAt: now },
    });

    if (claimed.count === 0) {
        return { processed: 0, sent: 0, failed: 0, retried: 0 };
    }

    for (const job of pending) {
        const html = job.html ?? `<pre>${escapeHtml(job.body)}</pre>`;
        const result = await deliverViaProvider({
            to: job.to,
            subject: job.subject,
            html,
        });

        const attempts = job.attempts + 1;

        if (result.ok) {
            await prisma.emailJob.update({
                where: { id: job.id },
                data: {
                    status: "sent",
                    attempts,
                    sentAt: new Date(),
                    lastError: null,
                },
            });
            sent++;
            continue;
        }

        if (attempts >= MAX_ATTEMPTS) {
            await prisma.emailJob.update({
                where: { id: job.id },
                data: { status: "failed", attempts, lastError: result.error },
            });
            failed++;
            continue;
        }

        // Exponential backoff: 2^attempts minutes (2, 4, 8, ...)
        const backoffMs = Math.pow(2, attempts) * 60_000;
        await prisma.emailJob.update({
            where: { id: job.id },
            data: {
                status: "pending",
                attempts,
                lastError: result.error,
                scheduledAt: new Date(Date.now() + backoffMs),
            },
        });
        retried++;
    }

    return { processed: pending.length, sent, failed, retried };
}

// ---------------------------------------------------------------------------
// Synchronous send (legacy / must-send-now callers)
// ---------------------------------------------------------------------------

/**
 * Send an email right now (blocks the request). Use only for
 * authentication flows where the user is waiting on the message
 * (password reset, 2FA, email verification). Everything else should
 * use queueEmail().
 *
 * An EmailJob row is still written for audit.
 */
export async function sendEmail(opts: {
    to: string;
    subject: string;
    html: string;
}): Promise<boolean> {
    // Record an audit row regardless of provider state.
    let jobId: string | null = null;
    try {
        const job = await prisma.emailJob.create({
            data: {
                to: opts.to,
                subject: opts.subject,
                body: opts.html, // fallback text body
                html: opts.html,
                status: "sending",
                attempts: 1,
            },
        });
        jobId = job.id;
    } catch {
        // Audit row is best-effort - continue with the send.
    }

    const result = await deliverViaProvider(opts);

    if (jobId) {
        try {
            await prisma.emailJob.update({
                where: { id: jobId },
                data: result.ok
                    ? { status: "sent", sentAt: new Date(), lastError: null }
                    : { status: "failed", lastError: result.error },
            });
        } catch {
            /* swallow - audit failures shouldn't mask the real result */
        }
    }

    return result.ok;
}

// ---------------------------------------------------------------------------
// Pre-rendered auth emails (must-send-now)
// ---------------------------------------------------------------------------

export async function sendPasswordResetEmail(email: string, resetUrl: string, locale?: string) {
    if (!(await getEmailEnabled())) {
        // The URL is logged only outside production. A developer with no SMTP
        // needs it to finish the flow; in production it is a single-use
        // account-takeover token sitting in the log aggregator.
        log.warn("email suppressed: no transport configured", {
            kind: "password-reset",
            to: email,
            ...(process.env.NODE_ENV === "production" ? {} : { resetUrl }),
        });
        return;
    }

    await sendEmail({
        to: email,
        subject: emailT(locale, "resetSubject"),
        html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1f2937;">${emailT(locale, "resetHeading")}</h2>
                <p style="color: #6b7280;">${emailT(locale, "resetIntro")}</p>
                <p style="color: #6b7280;">${emailT(locale, "resetCta")}</p>
                <a href="${escapeHtml(resetUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 16px 0;">
                    ${emailT(locale, "resetButton")}
                </a>
                <p style="color: #9ca3af; font-size: 14px;">${emailT(locale, "resetIgnore")}</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                <p style="color: #9ca3af; font-size: 12px;">${APP_NAME}</p>
            </div>
        `,
    });
}

export async function sendWelcomeEmail(email: string, username: string, locale?: string) {
    if (!(await getEmailEnabled())) {
        log.warn("email suppressed: no transport configured", { kind: "welcome", to: email, username });
        return;
    }

    // Welcome is non-urgent - queue it.
    await queueEmail({
        to: email,
        subject: emailT(locale, "welcomeSubject"),
        body: `${emailT(locale, "welcomeHeading", { username })} ${emailT(locale, "welcomeBody1")}`,
        html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1f2937;">${emailT(locale, "welcomeHeading", { username: escapeHtml(username) })}</h2>
                <p style="color: #6b7280;">${emailT(locale, "welcomeBody1")}</p>
                <p style="color: #6b7280;">${emailT(locale, "welcomeBody2")}</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                <p style="color: #9ca3af; font-size: 12px;">${APP_NAME}</p>
            </div>
        `,
    });
}

export async function sendVerificationEmail(email: string, verifyUrl: string, locale?: string) {
    if (!(await getEmailEnabled())) {
        log.warn("email suppressed: no transport configured", {
            kind: "email-verification",
            to: email,
            ...(process.env.NODE_ENV === "production" ? {} : { verifyUrl }),
        });
        return;
    }

    await sendEmail({
        to: email,
        subject: emailT(locale, "verifySubject"),
        html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1f2937;">${emailT(locale, "verifyHeading")}</h2>
                <p style="color: #6b7280;">${emailT(locale, "verifyBody")}</p>
                <a href="${escapeHtml(verifyUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 16px 0;">
                    ${emailT(locale, "verifyButton")}
                </a>
                <p style="color: #9ca3af; font-size: 14px;">${emailT(locale, "verifyIgnore")}</p>
            </div>
        `,
    });
}

/**
 * Sent to the address somebody is claiming. Until this link is answered the
 * account keeps the address it has, which is what makes a typo harmless and a
 * stranger's address useless to a hijacker.
 */
export async function sendEmailChangeVerification(email: string, token: string, locale?: string) {
    const confirmUrl = `${resolveAppUrl()}/auth/email-change?token=${encodeURIComponent(token)}`;
    if (!(await getEmailEnabled())) {
        log.warn("email suppressed: no transport configured", {
            kind: "email-change-verification",
            to: email,
            ...(process.env.NODE_ENV === "production" ? {} : { confirmUrl }),
        });
        return;
    }

    await sendEmail({
        to: email,
        subject: emailT(locale, "emailChangeSubject"),
        html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1f2937;">${emailT(locale, "emailChangeHeading")}</h2>
                <p style="color: #6b7280;">${emailT(locale, "emailChangeBody")}</p>
                <a href="${escapeHtml(confirmUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 16px 0;">
                    ${emailT(locale, "emailChangeButton")}
                </a>
                <p style="color: #9ca3af; font-size: 14px;">${emailT(locale, "emailChangeIgnore")}</p>
            </div>
        `,
    });
}

/**
 * Sent to the address on file, which is the only warning this kind of hijack
 * gives: somebody whose screen was borrowed for a minute finds a message
 * saying what was asked for, and what to do about it.
 */
export async function sendEmailChangeNotice(email: string, newEmail: string, locale?: string) {
    if (!(await getEmailEnabled())) {
        log.warn("email suppressed: no transport configured", { kind: "email-change-notice", to: email });
        return;
    }

    await sendEmail({
        to: email,
        subject: emailT(locale, "emailChangeNoticeSubject"),
        html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1f2937;">${emailT(locale, "emailChangeNoticeHeading")}</h2>
                <p style="color: #6b7280;">${emailT(locale, "emailChangeNoticeBody", { newEmail: escapeHtml(newEmail) })}</p>
                <p style="color: #b91c1c; font-size: 14px;">${emailT(locale, "emailChangeNoticeWarn")}</p>
            </div>
        `,
    });
}

/**
 * Sent when an account gets auto-locked after too many failed password
 * attempts. Gives the legitimate owner an early-warning signal that
 * someone is trying to sign in as them - critical for catching slow
 * credential-stuffing campaigns that don't trip IP rate limits.
 */
export async function sendAccountLockoutEmail(opts: {
    to: string;
    username: string;
    unlocksAt: Date;
    ip?: string;
    locale?: string;
}): Promise<void> {
    const unlocks = opts.unlocksAt.toUTCString();
    const ipLine = opts.ip
        ? `<p style="color: #6b7280;">${emailT(opts.locale, "lockoutIpLine")} <code>${escapeHtml(opts.ip)}</code>.</p>`
        : "";

    // Queue rather than send - this is informational. If the email system
    // is down, nothing is lost; the lock itself has already been armed.
    await queueEmail({
        to: opts.to,
        subject: emailT(opts.locale, "lockoutSubject"),
        body: emailT(opts.locale, "lockoutIntro") + " " + emailT(opts.locale, "lockoutUnlocks") + " " + unlocks,
        html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #b91c1c;">${emailT(opts.locale, "lockoutHeading")}</h2>
                <p style="color: #374151;">${emailT(opts.locale, "lockoutHi", { username: escapeHtml(opts.username) })}</p>
                <p style="color: #6b7280;">${emailT(opts.locale, "lockoutIntro")}</p>
                <p style="color: #6b7280;"><strong>${emailT(opts.locale, "lockoutUnlocks")}</strong> ${escapeHtml(unlocks)}</p>
                ${ipLine}
                <p style="color: #6b7280;">${emailT(opts.locale, "lockoutWasYou")}</p>
                <p style="color: #6b7280;">${emailT(opts.locale, "lockoutNotYou")}</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                <p style="color: #9ca3af; font-size: 12px;">${emailT(opts.locale, "lockoutFooter")}</p>
            </div>
        `,
    });
}
