/**
 * Turkish is written with Turkish letters.
 *
 * Three hundred and thirty-three strings in the tr catalogue were spelled
 * without their diacritics - "Moderasyon kuyugunu ac", "islem basariyla
 * tamamlandi", "Devre Disi" - and nothing said so. They read to a Turkish
 * speaker the way "Setttings savedd" reads in English: understandable, and
 * obviously nobody checked. They accumulated because each one arrives alone,
 * inside an otherwise correct sentence, in a file nobody reads end to end.
 *
 * A dictionary would be the obvious gate and the wrong one: it would need
 * maintaining, and every product word - a module name, a game, a brand -
 * would be a false positive to allowlist. So the catalogue checks itself.
 * Almost every misspelling here has a correctly spelled twin somewhere in the
 * same catalogue, because the same word was translated properly by someone
 * else on another screen. Fold "ışğçöü" onto "isgcou", collect every word
 * that IS spelled with a diacritic, and any plain-ASCII word that folds onto
 * one of them is a word we know how to spell and did not.
 *
 * Case is the one thing the fold gets wrong on its own: "izin" and "İzin"
 * fold together and differ only in capitalization, while "Istemci" for
 * "İstemci" is a real mistake, because a capital ASCII I lowercases to ı in
 * Turkish and never to i. Lowercasing both sides the Turkish way separates
 * the two. What the fold cannot see at all is a word that was misspelled in
 * every one of its occurrences, leaving no correct twin to measure against;
 * those are listed by hand in `KNOWN_MISSPELLINGS`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const SOURCES = join(ROOT, "module-sources");

/** Wrong everywhere they appear, so the catalogue holds no correct twin. */
const KNOWN_MISSPELLINGS: Record<string, string> = {
    ac: "aç", Ag: "Ağ", aciktir: "açıktır", acikken: "açıkken",
    agirligi: "ağırlığı", Alicisi: "Alıcısı", anahtarinizi: "anahtarınızı",
    Aracisi: "Aracısı", arasinda: "arasında", ayarlarindan: "ayarlarından",
    Ayir: "Ayır", ayrildi: "ayrıldı", Bagimliliklar: "Bağımlılıklar",
    baglanilamadi: "bağlanılamadı", Baslayalim: "Başlayalım",
    baslatin: "başlatın", Basliklar: "Başlıklar", Basvur: "Başvur",
    basvurunuzu: "başvurunuzu", Bunlari: "Bunları",
    calistirildi: "çalıştırıldı", calistirilamadi: "çalıştırılamadı",
    Damgasi: "Damgası", degiskenleri: "değişkenleri",
    donebilirsiniz: "dönebilirsiniz", dosyanizda: "dosyanızda",
    Dusuncelerinizi: "Düşüncelerinizi", fazlasini: "fazlasını",
    Gelistirme: "Geliştirme", gerektirdigini: "gerektirdiğini",
    gorunmeden: "görünmeden", gosterilmeden: "gösterilmeden",
    gosterme: "gösterme", Gunun: "Günün", hakki: "hakkı", Hakki: "Hakkı",
    Incele: "İncele", Incelemeler: "İncelemeler", Incelendi: "İncelendi",
    istediginiz: "istediğiniz", Iyilesme: "İyileşme", Izlemeyi: "İzlemeyi",
    Karti: "Kartı", kazanin: "kazanın", kimligini: "kimliğini",
    Kimligini: "Kimliğini", kimliginizi: "kimliğinizi", konularinin: "konularının",
    konusma: "konuşma", Konusma: "Konuşma", korumasini: "korumasını",
    kullanilacak: "kullanılacak", kuralim: "kuralım", kuruldugu: "kurulduğu",
    kuyugunu: "kuyruğunu", okunamadi: "okunamadı", Olaylari: "Olayları",
    onerilerinin: "önerilerinin", ornek: "örnek", ortaminizda: "ortamınızda",
    Puanlanmamis: "Puanlanmamış", saglayicilari: "sağlayıcıları",
    saglayicisini: "sağlayıcısını", Saglayiciya: "Sağlayıcıya",
    saglayin: "sağlayın", satirini: "satırını", Sayfanin: "Sayfanın",
    Sinirlamasi: "Sınırlaması", Sirada: "Sırada", siteadiniz: "siteadınız",
    sonlandirilsin: "sonlandırılsın", sunucularinizi: "sunucularınızı",
    Sablon: "Şablon", tanimlain: "tanımlayın", tanimlayip: "tanımlayıp",
    tanisin: "tanışın", toplulugunuzu: "topluluğunuzu", turlerinin: "türlerinin",
    Ucnokta: "Uç Nokta", uygulamanizin: "uygulamanızın", uygulamayi: "uygulamayı",
    Uygulamayi: "Uygulamayı", ustundeki: "üstündeki", uyelere: "üyelere",
    uyelerimizle: "üyelerimizle", uyesini: "üyesini", Uyeyi: "Üyeyi",
    uzeresiniz: "üzeresiniz", yapilacaktir: "yapılacaktır",
    yapilandirmadi: "yapılandırmadı", yapilsin: "yapılsın", Yasagi: "Yasağı",
    yorumlarin: "yorumların", Yontemleri: "Yöntemleri",
};

/** ICU keywords are English by specification and never translated. */
const ICU = new Set(["one", "other", "zero", "two", "few", "many", "plural", "select", "selectordinal"]);

/**
 * Turkish words that happen to fold onto a different Turkish word.
 *
 * The fold assumes a plain-ASCII word that matches a diacritic one is the
 * same word with the dots filed off. Usually it is. Sometimes both spellings
 * are words in their own right, and then the rule accuses the correct one.
 *
 * "ise" is the case that found this: it is the conditional and the topic
 * marker - "0 ise", "herkeste ise" - and it folds onto "işe", the dative of
 * "iş". Neither is a misspelling of the other, and the catalogue held only
 * one of them until a module wrote "bu işe yaramadı", at which point two
 * correct sentences written years earlier started failing this gate.
 *
 * Kept short and argued for one word at a time. A long list here would turn
 * the gate back into the dictionary it exists to avoid being.
 */
const DISTINCT_WORDS = new Set(["ise"]);

const TURKISH = "ışğçöüİŞĞÇÖÜ";
const ASCII_____ = "isgcouISGCOU";
const WORD = /[A-Za-zçÇğĞıİöÖşŞüÜ]+/g;
const PLACEHOLDER = /\{[^}]*\}/g;

function fold(word: string): string {
    return [...word].map((c) => {
        const at = TURKISH.indexOf(c);
        return at === -1 ? c : ASCII_____[at];
    }).join("");
}

/** Turkish casing: İ lowercases to i, and I to ı. */
function trLower(word: string): string {
    return word.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/**
 * True when `plain` is `proper` with the dots and tails filed off, rather
 * than the same word in another case. The two already fold together, so any
 * difference that survives a Turkish-aware lowercasing is a letter someone
 * could not type: "YAYINCI" is how "Yayıncı" is shouted, but "Istemci" is
 * not how "İstemci" is written.
 */
function isDroppedDiacritic(plain: string, proper: string): boolean {
    return trLower(plain) !== trLower(proper);
}

function strings(value: unknown, into: string[]): void {
    if (typeof value === "string") into.push(value);
    else if (value && typeof value === "object")
        for (const inner of Object.values(value as Record<string, unknown>)) strings(inner, into);
}

function turkishCatalogue(): { source: string; text: string }[] {
    const out: { source: string; text: string }[] = [];
    const push = (source: string, value: unknown) => {
        const found: string[] = [];
        strings(value, found);
        for (const text of found) out.push({ source, text });
    };
    push("messages-core/tr.json", JSON.parse(readFileSync(join(ROOT, "messages-core/tr.json"), "utf-8")));
    if (existsSync(SOURCES)) {
        for (const entry of readdirSync(SOURCES, { withFileTypes: true })) {
            const manifest = join(SOURCES, entry.name, "module.json");
            if (!entry.isDirectory() || !existsSync(manifest)) continue;
            const parsed = JSON.parse(readFileSync(manifest, "utf-8"));
            push(entry.name, parsed?.translations?.tr ?? {});
        }
    }
    return out;
}

function wordsIn(text: string): string[] {
    return text.replace(PLACEHOLDER, " ").match(WORD) ?? [];
}

describe("the Turkish catalogue", () => {
    const catalogue = turkishCatalogue();

    it("is large enough to be worth checking", () => {
        expect(catalogue.length).toBeGreaterThan(3000);
    });

    it("spells every word the way it spells that word elsewhere", () => {
        const proper = new Map<string, Set<string>>();
        for (const { text } of catalogue) {
            for (const word of wordsIn(text)) {
                if (word.length < 3 || fold(word) === word) continue;
                const key = fold(word).toLowerCase();
                if (!proper.has(key)) proper.set(key, new Set());
                proper.get(key)!.add(word);
            }
        }

        const offenders: string[] = [];
        for (const { source, text } of catalogue) {
            for (const word of wordsIn(text)) {
                if (word.length < 3 || fold(word) !== word) continue;
                if (ICU.has(word.toLowerCase()) || DISTINCT_WORDS.has(word.toLowerCase())) continue;
                const twins = proper.get(word.toLowerCase());
                if (!twins) continue;
                const correct = [...twins].find((twin) => isDroppedDiacritic(word, twin));
                if (correct) offenders.push(`${source}: "${text}" (${word} -> ${correct})`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("does not reuse a spelling that is wrong everywhere it appears", () => {
        const offenders: string[] = [];
        for (const { source, text } of catalogue) {
            for (const word of wordsIn(text)) {
                const correct = KNOWN_MISSPELLINGS[word];
                if (correct) offenders.push(`${source}: "${text}" (${word} -> ${correct})`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("keeps the hand-written list honest", () => {
        // The left-hand side is what a keyboard without Turkish letters
        // produces, so it is plain ASCII by definition, and the right-hand
        // side has to be different or the entry says nothing.
        for (const [wrong, right] of Object.entries(KNOWN_MISSPELLINGS)) {
            expect(fold(wrong), `${wrong} is not plain ASCII`).toBe(wrong);
            expect(right, `${wrong} is its own correction`).not.toBe(wrong);
        }
    });
});
