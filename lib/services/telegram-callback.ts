import type {
  PendingActionRepo,
  LeadRepo,
  SuppressionRepo,
  MessageRepo,
  EventRepo,
  EmailProvider,
  NotifyPort,
} from "../domain/ports";
import type { PendingAction } from "../domain/types";

// Telegram callback_query — minimal duck-type (grammy Update tam tipinden bağımsız).
export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from?: { id?: number | string };
  message?: {
    chat?: { id?: number | string };
    message_id?: number;
  };
}

export interface TelegramCallbackDeps {
  pendingActions: PendingActionRepo;
  leads: LeadRepo;
  supp: SuppressionRepo;
  msgs: MessageRepo;
  events: EventRepo;
  mail: EmailProvider;
  notify: NotifyPort;
}

// Pending payload'da T7/T9 tarafından doldurulan Telegram lokasyon bilgisi.
export interface PendingTelegramRef {
  chatId: string;
  messageId: number;
}

function getTelegramRef(p: PendingAction): PendingTelegramRef | null {
  const raw = (p.payload as Record<string, unknown>)?.telegram;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
  const messageId = typeof obj.messageId === "number" ? obj.messageId : null;
  if (!chatId || messageId == null) return null;
  return { chatId, messageId };
}

function hhmm(d: Date = new Date()): string {
  return d.toTimeString().slice(0, 5);
}

export function createTelegramCallbackService(deps: TelegramCallbackDeps) {
  // Mevcut Telegram mesajını edit'ler (buton kaldırma + status satırı).
  // Payload'da chatId/messageId yoksa sessizce no-op. Edit hatası best-effort.
  async function editStatus(pending: PendingAction, statusText: string): Promise<void> {
    const ref = getTelegramRef(pending);
    if (!ref) return;
    try {
      await deps.notify.edit(ref.chatId, ref.messageId, statusText);
    } catch {
      /* edit best-effort — Telegram 400 (mesaj çok eski) vs. */
    }
  }

  // T3'te genel "open" handler — pending'i resolve eder, Gmail'e yönlendirildi mesajı,
  // ack toast. T8/T10 callbacks bunu reuse eder.
  async function handleOpen(
    pending: PendingAction,
    cb: TelegramCallbackQuery,
  ): Promise<void> {
    const resolved = await deps.pendingActions.resolve(pending.id, "resolved");
    if (!resolved) {
      await deps.notify.answerCallback(cb.id, { text: "Zaten yapıldı" });
      return;
    }
    await editStatus(pending, "↗ Gmail'e yönlendirildi");
    await deps.notify.answerCallback(cb.id, { text: "Gmail'e açıldı" });
    await deps.events.log("pending_opened_in_gmail", pending.leadId, {
      kind: pending.kind,
      pendingId: pending.id,
    });
  }

  async function handle(cb: TelegramCallbackQuery): Promise<void> {
    const raw = String(cb.data ?? "");
    const parts = raw.split(":");
    if (parts.length !== 3 || parts[0] !== "act") {
      await deps.notify.answerCallback(cb.id, { text: "Geçersiz aksiyon" });
      return;
    }
    const prefix = parts[1];
    const verb = parts[2];
    if (!prefix || prefix.length !== 8) {
      await deps.notify.answerCallback(cb.id, { text: "Geçersiz prefix" });
      return;
    }

    const pending = await deps.pendingActions.byPrefix(prefix);
    if (!pending) {
      await deps.notify.answerCallback(cb.id, { text: "Bu işlem bulunamadı" });
      return;
    }

    // Status edge cases (ADR-0006 §2.7 E3, E4).
    if (pending.status !== "pending") {
      const toast =
        pending.status === "resolved"
          ? `Zaten yapıldı (${pending.resolvedAt ? hhmm(pending.resolvedAt) : ""})`
          : pending.status === "cancelled"
            ? "Zaten iptal edilmiş"
            : "⏱ 7 günden eski";
      await deps.notify.answerCallback(cb.id, { text: toast });
      return;
    }
    if (pending.expiresAt < new Date()) {
      await deps.pendingActions.resolve(pending.id, "expired");
      await deps.notify.answerCallback(cb.id, { text: "⏱ 7 günden eski" });
      return;
    }

    // Verb dispatch. T8 (confirm_demo_time:confirm) + T10 (send_draft:send|cancel)
    // bu noktadan sonra eklenir.
    if (verb === "open") return handleOpen(pending, cb);

    await deps.notify.answerCallback(cb.id, {
      text: "Bu aksiyon henüz hazır değil",
    });
  }

  return { handle };
}

export type TelegramCallbackService = ReturnType<typeof createTelegramCallbackService>;
