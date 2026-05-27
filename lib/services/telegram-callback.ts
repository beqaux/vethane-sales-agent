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
import { BRAND } from "../config/runtime";
import { extractFirstName, renderConfirmTemplate } from "../util/demo-template";

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

    // Verb dispatch.
    if (verb === "open") return handleOpen(pending, cb);
    if (pending.kind === "confirm_demo_time" && verb === "confirm") {
      return handleConfirmDemoTime(pending, cb);
    }

    await deps.notify.answerCallback(cb.id, {
      text: "Bu aksiyon henüz hazır değil",
    });
  }

  // ADR-0006 §2.1 akış #3 — demo zaman onayı.
  // Order: CAS resolve first (double-tap protection) → guards → mail send →
  // edit + ack + event log. E5/E6 refuse. E8 (gmail fail) → edit "❌" + log.
  async function handleConfirmDemoTime(
    pending: PendingAction,
    cb: TelegramCallbackQuery,
  ): Promise<void> {
    // Atomic CAS — double-tap kazananı bir tane.
    const claimed = await deps.pendingActions.resolve(pending.id, "resolved");
    if (!claimed) {
      await deps.notify.answerCallback(cb.id, { text: "Zaten yapıldı" });
      return;
    }

    const lead = await deps.leads.byId(pending.leadId);
    if (!lead) {
      await editStatus(pending, "❌ Lead bulunamadı — gönderilmedi");
      await deps.notify.answerCallback(cb.id, { text: "Lead bulunamadı" });
      return;
    }

    // E5: lead durumu değişmiş.
    if (lead.durum === "kaybedildi" || lead.durum === "cikti") {
      await editStatus(
        pending,
        `ℹ️ Lead durumu değişmiş (${lead.durum}), gönderilmedi`,
      );
      await deps.notify.answerCallback(cb.id, { text: "Lead durumu değişmiş" });
      await deps.events.log("demo_time_skipped_durum", lead.id, {
        durum: lead.durum,
        pendingId: pending.id,
      });
      return;
    }

    const payload = pending.payload as Record<string, unknown>;
    const fromEmail = typeof payload.fromEmail === "string" ? payload.fromEmail : null;
    const proposedTimeRaw =
      typeof payload.proposedTimeRaw === "string" ? payload.proposedTimeRaw : null;
    const subject = typeof payload.subject === "string" ? payload.subject : "";
    const headerMessageId =
      typeof payload.headerMessageId === "string" ? payload.headerMessageId : null;

    if (!fromEmail || !proposedTimeRaw) {
      await editStatus(pending, "❌ Pending payload eksik — gönderilmedi");
      await deps.notify.answerCallback(cb.id, { text: "Payload eksik" });
      await deps.events.log("demo_time_payload_missing", lead.id, {
        pendingId: pending.id,
      });
      return;
    }

    // E6: suppression.
    if (await deps.supp.has(fromEmail)) {
      await editStatus(pending, "ℹ️ Email suppression'da, gönderilmedi");
      await deps.notify.answerCallback(cb.id, { text: "Suppression" });
      return;
    }

    const ad = extractFirstName(lead, fromEmail);
    const body = renderConfirmTemplate(ad, proposedTimeRaw, BRAND.senderName);
    const replySubject = /^re:\s/i.test(subject) ? subject : `Re: ${subject}`;

    try {
      const created = await deps.mail.createDraft(
        pending.gmailThreadId,
        fromEmail,
        replySubject,
        body,
        headerMessageId,
      );
      await deps.mail.send(created.id);
      await deps.msgs.add({
        leadId: lead.id,
        direction: "out",
        gmailMessageId: null,
        subject: replySubject,
        body,
        classification: null,
        status: "sent",
      });
      await editStatus(
        pending,
        `✅ Onaylandı ${hhmm()} — confirmation maili gönderildi`,
      );
      await deps.notify.answerCallback(cb.id, { text: "Gönderildi" });
      await deps.events.log("demo_time_confirmed", lead.id, {
        raw: proposedTimeRaw,
        draftId: created.id,
        pendingId: pending.id,
      });
    } catch (e) {
      const err = e as Error;
      // E8: send fail — kurucu Gmail'den manuel atsın. Pending zaten 'resolved',
      // re-tap çalışmaz — kurucu fallback olarak ✏️ Gmail butonunu kullanabilir
      // (URL buton, callback yok).
      await editStatus(
        pending,
        "❌ Gönderim başarısız — kurucu Gmail'den manuel atsın",
      );
      await deps.notify.answerCallback(cb.id, {
        text: "Gönderim başarısız",
        alert: true,
      });
      await deps.events.log("demo_time_send_failed", lead.id, {
        error: err.message,
        pendingId: pending.id,
      });
    }
  }

  return { handle };
}

export type TelegramCallbackService = ReturnType<typeof createTelegramCallbackService>;
