import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { retry } from "../util/retry";
import { AiError } from "../domain/errors";
import { ClassificationSchema } from "../domain/schemas";
import { buildSystemPrompt, buildUserPrompt } from "../ai/prompts";
import type { AiPort } from "../domain/ports";

// Hibrit: draft Sonnet 4.6 (kaliteli Türkçe + reasoning), classify Haiku 4.5 (hızlı/ucuz/structured).
// Haiku draft testi: sayı uydurma + yapay Türkçe ("Handaki", "Tüm sistem harika") → upgrade.
// Tek API key (ANTHROPIC_API_KEY) — sadece model string değişti.
export const MODELS = {
  draft: anthropic("claude-sonnet-4-6"),
  classify: anthropic("claude-haiku-4-5"),
} as const;

const DraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

const CLASSIFY_SYSTEM = `Sen, satış outreach'ine gelen e-posta cevaplarını sınıflayan bir asistansın (Türkçe).
Sınıflar:
- fiyat: fiyat/ücret/maliyet soruyor
- demo: demo, görüşme, sunum veya tanıtım istiyor
- ilgili: olumlu/ilgili ama net demo veya fiyat talebi yok
- ilgisiz: ilgilenmiyor / kibar ret (çıkış talebi DEĞİL)
- oto_yanit: otomatik yanıt (ofis dışı, tatil, no-reply)
- cikis: listeden çıkmak, "dur", spam şikâyeti, abonelikten çık
- satis_spami: Vethane veteriner bağlamı dışında başka bir ürün/servis pazarlayan cold mail
  (ör. başka SaaS demo daveti, ajans pitch, backlink takası). Lead'le ilgili DEĞİL.
confidence: 0-1 güven. segmentGuess: imza/içerikten klinik büyüklüğü tahmini (varsa).
vetCountGuess: mesajda veteriner sayısı açıkça yazıyorsa o sayı (örn. "4 veterinerimiz var" → 4).
  ÖNEMLİ: Önceki Vethane mesajı "Kaç veteriner ile çalıştığınızı öğrenebilir miyim?" sorduysa ve
  müşteri sadece bir sayı yazdıysa ("3", "4 vet", "5 kişi" gibi) → o sayı vetCountGuess'tir.
  Yazmıyorsa boş bırak.

proposedTime.raw: Eğer mesaj GELECEK bir tarih için spesifik bir gün+saat önerisi içeriyorsa
(örn. "Salı 14:00 müsait", "yarın 10'da", "27 Mayıs Çarşamba 14:00"), müşterinin TAM o
ifadesini (substring olarak) yaz. Gün VEYA saat yoksa, ya da geçmiş tarih ise alanı boş
bırak. UYDURMA — sadece mesajda LİTERAL geçen ifadeyi yaz; ek karakter ekleme,
tırnaklarla bütünleştirme.`;

export const aiAdapter: AiPort = {
  async writeDraft(req) {
    try {
      const { object } = await retry(() =>
        generateObject({
          model: MODELS.draft,
          schema: DraftSchema,
          system: buildSystemPrompt(req),
          prompt: buildUserPrompt(req),
        }),
      );
      return { subject: object.subject, body: object.body };
    } catch (e) {
      throw new AiError("taslak üretilemedi", e);
    }
  },

  async classify(msg) {
    try {
      const { object } = await retry(() =>
        generateObject({
          model: MODELS.classify,
          schema: ClassificationSchema,
          system: CLASSIFY_SYSTEM,
          prompt: `Gönderen: ${msg.fromEmail}\nKonu: ${msg.subject}\n\nMesaj:\n${msg.body}`,
        }),
      );
      return object;
    } catch (e) {
      throw new AiError("sınıflama başarısız", e);
    }
  },
};
