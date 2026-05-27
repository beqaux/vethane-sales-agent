import { telegramCallbackService, eventRepo, telegramAdapter } from "@/lib/wiring";
import type { TelegramCallbackQuery } from "@/lib/services/telegram-callback";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface TelegramUpdate {
  update_id?: number;
  callback_query?: TelegramCallbackQuery;
  // Diğer update tipleri (message, etc.) ignore — setWebhook
  // allowed_updates=["callback_query"] ile zaten gönderilmemeli.
}

/**
 * ADR-0006 §2.6: Telegram inline-button callback webhook.
 *
 * Güvenlik katmanları:
 * 1. `x-telegram-bot-api-secret-token` header → `TELEGRAM_WEBHOOK_SECRET`.
 * 2. `callback_query.from.id` allowlist → `TELEGRAM_CHAT_ID` (tek kurucu).
 *
 * Telegram 5xx'leri retry eder (=duplicate işlem). Bizim hatalar içerde
 * loglanır + `answerCallbackQuery` ile kullanıcıya bildirilir; route hep 200/401 döner.
 */
async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TelegramUpdate | null = null;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    // Geçersiz JSON — 200 dön ki Telegram retry'lamasın.
    return new Response("ok");
  }

  const cb = update?.callback_query;
  if (!cb) return new Response("ok"); // message update'leri ignore

  const fromId = String(cb.from?.id ?? "");
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!allowedChatId || fromId !== allowedChatId) {
    await eventRepo.log("telegram_unauthorized_callback", null, {
      fromId,
      dataPreview: String(cb.data ?? "").slice(0, 20),
    });
    return new Response("ok");
  }

  try {
    await telegramCallbackService.handle(cb);
  } catch (e) {
    await eventRepo.log("telegram_callback_error", null, {
      error: (e as Error).message,
      dataPreview: String(cb.data ?? "").slice(0, 20),
    });
    try {
      await telegramAdapter.answerCallback(cb.id, {
        text: "İç hata — log'a düştü",
        alert: true,
      });
    } catch {
      /* answerCallback başarısız — sonraki tap yeniden dener */
    }
  }
  return new Response("ok");
}

export const POST = handle;
