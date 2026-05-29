import { BRAND } from "../config/runtime";
import type { DraftRequest } from "../domain/types";

// mid/hospital prompt'unda bu marker MUTLAKA bulunur (üçlü korumanın 1. katmanı).
export const PRICE_BAN_MARKER = "FİYAT/SAYI YAZMA";

export function buildSystemPrompt(req: DraftRequest): string {
  const k = req.knowledge;
  const parts: string[] = [
    "Sen Vethane'in Türkçe yazan, kısa ve profesyonel B2B satış asistanısın.",
    "## Vethane Konumlandırma\n" + k.positioning,
    "## SSS\n" + k.faq,
    "## İtiraz Karşılama\n" + k.objections,
    "## Kurallar",
    "- Kısa tut (mid/hastane ~120 kelime, solo ~80). Tek net mesaj, doğal Türkçe.",
    `- İmza: ${BRAND.senderName} — ${BRAND.senderEmail}.`,
    "- İndirim, garanti veya taahhüt VERME.",
    "- ASLA önceki mesajdan özür dileme veya geri çekme ('fiyat paylaşmışız, kusura bakmayın' gibi). Akışı doğal devam ettir.",
  ];
  // NOT: Cold opt-out satırı AI'a BIRAKILMAZ — outbound servisi deterministik ekler
  // (lib/services/outbound.ts). Prompt'ta tekrar istemek mükerrer opt-out'a yol açıyordu.
  if (req.segment === "mid" || req.segment === "hospital") {
    parts.push(
      `- ${PRICE_BAN_MARKER}: Bu segmentte değer-satışı yapılır. E-postada KESİNLİKLE fiyat, rakam, ücret veya para birimi (₺ / TL) GEÇMESİN. Fiyat sorulursa 2-adımlı satışa yönlendir: "Klinik büyüklüğüne göre değişiyor; 20 dk'lık bir demoda sistemi göstereyim, teklifi ardından ayrı bir görüşmede sunarım."`,
    );
  } else {
    parts.push(
      req.priceText
        ? `- FİYAT KURALI (KESİN): Aşağıdaki priceText'i KOPYALA-YAPIŞTIR, BİR HARFİNİ DEĞİŞTİRME.
  ASLA yeni satır/yeni örnek/yeni rakam EKLEME (örn. "2 vet ≈ X ₺" satırı yasaktır eğer priceText'te yoksa).
  Sayı UYDURMA. Tablolaştırma. Bullet ekle/çıkar yapma.
  priceText: """${req.priceText}"""`
        : "- Fiyat sorulmadıkça verme.",
    );
  }
  parts.push(
    "- Türkçe doğal akıcı yaz. Çeviri kokuyor → kullanma. Örnek YASAK ifadeler: " +
      "'Tüm sistem — harika', 'Handaki', 'Bize uygun saatleri yazabilir misiniz' (yapay), " +
      "'sistemde neler olabileceğini', 'kliniğinize tam uyumlu olup olmadığını'. " +
      "Doğal Türkçe: 'Anlaştık', 'Not aldım', 'Sizin için uygun gün/saati paylaşır mısınız?'",
  );
  return parts.join("\n");
}

export function buildUserPrompt(req: DraftRequest): string {
  const L = req.lead;
  const lines: Array<string | null> = [
    `Klinik: ${L.kurumAdi}${L.sehir ? ", " + L.sehir : ""}`,
    L.kararVerici ? `Karar-verici: ${L.kararVerici}` : null,
    `Segment: ${req.segment}`,
    `Amaç: ${req.goal}`,
    `Yönerge: ${req.guidance}`,
    req.priceText ? `Fiyat (yalnız solo): ${req.priceText}` : null,
    req.trialUrl ? `Deneme linki: ${req.trialUrl}` : null,
    req.threadContext ? `Önceki yazışma:\n${req.threadContext}` : null,
    req.isReply ? "Bu bir CEVAP — gelen mesaja uygun yanıt yaz." : "Bu İLK temas / takip.",
    "Çıktı: kısa bir konu (subject) ve gövde (body).",
  ];
  return lines.filter((x): x is string => x !== null).join("\n");
}
