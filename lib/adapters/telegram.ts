import { Api } from "grammy";
import { retry } from "../util/retry";
import { ExternalServiceError } from "../domain/errors";
import type { NotifyPort, NotifyOptions, ButtonRow } from "../domain/ports";

function toKeyboard(buttons?: ButtonRow[]):
  | { inline_keyboard: ButtonRow[] }
  | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  return { inline_keyboard: buttons };
}

function createTelegramAdapter(): NotifyPort {
  let api: Api | null = null;
  function getApi(): Api {
    if (api) return api;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new ExternalServiceError("TELEGRAM_BOT_TOKEN tanımlı değil");
    api = new Api(token);
    return api;
  }

  function getChatId(): string {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new ExternalServiceError("TELEGRAM_CHAT_ID tanımlı değil");
    return chatId;
  }

  return {
    async notify(text, opts?: NotifyOptions) {
      const chatId = getChatId();
      const replyMarkup = toKeyboard(opts?.buttons);
      try {
        const res = await retry(() =>
          getApi().sendMessage(chatId, text, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
        );
        return { messageId: res.message_id, chatId };
      } catch (e) {
        throw new ExternalServiceError("Telegram bildirim hatası", e);
      }
    },

    async edit(chatId, messageId, text, opts?: NotifyOptions) {
      const replyMarkup = toKeyboard(opts?.buttons);
      try {
        await retry(() =>
          getApi().editMessageText(chatId, messageId, text, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
        );
      } catch (e) {
        throw new ExternalServiceError("Telegram edit hatası", e);
      }
    },

    async answerCallback(callbackQueryId, opts) {
      try {
        await retry(() =>
          getApi().answerCallbackQuery(callbackQueryId, {
            ...(opts?.text ? { text: opts.text } : {}),
            ...(opts?.alert ? { show_alert: true } : {}),
          }),
        );
      } catch (e) {
        throw new ExternalServiceError("Telegram answerCallback hatası", e);
      }
    },
  };
}

export const telegramAdapter = createTelegramAdapter();
