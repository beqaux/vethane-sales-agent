import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { retry } from "../util/retry";
import { AiError } from "../domain/errors";
import { ClassificationSchema } from "../domain/schemas";
import { buildSystemPrompt, buildUserPrompt } from "../ai/prompts";
import type { AiPort } from "../domain/ports";

// Tek provider: Anthropic Claude Haiku 4.5 (Ocak 2026, Türkçe iyi).
// draft + classify aynı model — operasyonel basit, tek API key (ANTHROPIC_API_KEY).
// Gemini "project denied access" hatası sonrası geçildi.
export const MODELS = {
  draft: anthropic("claude-haiku-4-5"),
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
vetCountGuess: mesajda veteriner sayısı açıkça yazıyorsa o sayı (örn. "4 veterinerimiz var" → 4). Yazmıyorsa boş bırak.`;

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
