import { Api } from "grammy";
import { retry } from "../util/retry";
import { ExternalServiceError } from "../domain/errors";
import type { NotifyPort } from "../domain/ports";

function createTelegramAdapter(): NotifyPort {
  let api: Api | null = null;
  function getApi(): Api {
    if (api) return api;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new ExternalServiceError("TELEGRAM_BOT_TOKEN tanımlı değil");
    api = new Api(token);
    return api;
  }

  return {
    async notify(text) {
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!chatId) throw new ExternalServiceError("TELEGRAM_CHAT_ID tanımlı değil");
      try {
        await retry(() =>
          getApi().sendMessage(chatId, text, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          }),
        );
      } catch (e) {
        throw new ExternalServiceError("Telegram bildirim hatası", e);
      }
    },
  };
}

export const telegramAdapter = createTelegramAdapter();
