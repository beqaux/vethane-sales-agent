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
    if (pending.kind === "send_draft" && verb === "send") {
      return handleSendDraft(pending, cb);
    }
    if (pending.kind === "send_draft" && verb === "cancel") {
      return handleCancelDraft(pending, cb);
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

  // ADR-0006 §2.1 akış #1 (#5 reuse) — taslak gönder/iptal.
  // Order: CAS resolve → guards → mail.send/deleteDraft → edit + ack + event.
  // E1/E2/E5/E6/E8 PROMPT §3.5 + §6.

  function eventTag(p: PendingAction, base: "sent" | "cancelled"): string {
    const payload = p.payload as Record<string, unknown>;
    const action = typeof payload.action === "string" ? payload.action : "unknown";
    // mid_cold/hospital_cold → cold_draft_*_via_telegram
    // mid_reply/hospital_reply/solo_* (T11) → uncertain_reply_*_via_telegram
    const isCold = action === "mid_cold" || action === "hospital_cold";
    const prefix = isCold ? "cold_draft" : "uncertain_reply";
    return `${prefix}_${base}_via_telegram`;
  }

  async function refuseSend(
    pending: PendingAction,
    cb: TelegramCallbackQuery,
    statusText: string,
    toast: string,
    eventType: string,
    leadId: string | null,
    eventPayload: Record<string, unknown>,
  ): Promise<void> {
    // Pending'i cancelled'a alıp Gmail draft'ı temizliyoruz (varsa).
    const claimed = await deps.pendingActions.resolve(pending.id, "cancelled");
    if (!claimed) {
      await deps.notify.answerCallback(cb.id, { text: "Zaten yapıldı" });
      return;
    }
    if (pending.gmailDraftId) {
      try {
        await deps.mail.deleteDraft(pending.gmailDraftId);
      } catch {
        /* draft zaten silinmiş olabilir — best-effort */
      }
    }
    await editStatus(pending, statusText);
    await deps.notify.answerCallback(cb.id, { text: toast });
    await deps.events.log(eventType, leadId, eventPayload);
  }

  async function handleSendDraft(
    pending: PendingAction,
    cb: TelegramCallbackQuery,
  ): Promise<void> {
    const lead = await deps.leads.byId(pending.leadId);
    if (!lead) {
      await refuseSend(
        pending,
        cb,
        "❌ Lead bulunamadı — taslak iptal",
        "Lead bulunamadı",
        "send_draft_lead_missing",
        null,
        { pendingId: pending.id },
      );
      return;
    }

    // E5: lead durumu değişmiş (kaybedildi/cikti).
    if (lead.durum === "kaybedildi" || lead.durum === "cikti") {
      await refuseSend(
        pending,
        cb,
        `ℹ️ Lead durumu değişmiş (${lead.durum}), gönderilmedi`,
        "Lead durumu değişmiş",
        "send_draft_skipped_durum",
        lead.id,
        { durum: lead.durum, pendingId: pending.id },
      );
      return;
    }

    // E1: müşteri arada cevap verdi (durum=cevap_geldi).
    if (lead.durum === "cevap_geldi") {
      await refuseSend(
        pending,
        cb,
        "⚠️ Müşteri arada cevap verdi — taslak iptal",
        "Müşteri cevap verdi",
        "send_draft_skipped_reply_arrived",
        lead.id,
        { pendingId: pending.id },
      );
      return;
    }

    // E6: suppression (lead.email).
    const toEmail = lead.email;
    if (toEmail && (await deps.supp.has(toEmail))) {
      await refuseSend(
        pending,
        cb,
        "ℹ️ Email suppression'da, gönderilmedi",
        "Suppression",
        "send_draft_skipped_suppression",
        lead.id,
        { pendingId: pending.id },
      );
      return;
    }

    // E2: Gmail draft hala var mı?
    if (!pending.gmailDraftId) {
      await refuseSend(
        pending,
        cb,
        "❌ Draft id eksik — gönderilmedi",
        "Draft eksik",
        "send_draft_missing_draft_id",
        lead.id,
        { pendingId: pending.id },
      );
      return;
    }
    try {
      await deps.mail.getDraft(pending.gmailDraftId);
    } catch (e) {
      await refuseSend(
        pending,
        cb,
        "❌ Draft Gmail'de bulunamadı — taslak iptal",
        "Draft bulunamadı",
        "send_draft_missing_in_gmail",
        lead.id,
        { pendingId: pending.id, error: (e as Error).message },
      );
      return;
    }

    // CAS resolve (double-tap atomic).
    const claimed = await deps.pendingActions.resolve(pending.id, "resolved");
    if (!claimed) {
      await deps.notify.answerCallback(cb.id, { text: "Zaten yapıldı" });
      return;
    }

    try {
      await deps.mail.send(pending.gmailDraftId);
      // Outbound message kaydı: status='sent' (mevcut 'draft' satırı dokunulmaz —
      // events log + status='sent' duplicate satırı kurucu için audit).
      await deps.msgs.add({
        leadId: lead.id,
        direction: "out",
        gmailMessageId: null,
        subject: null,
        body: null,
        classification: null,
        status: "sent",
      });
      await editStatus(pending, `✅ Gönderildi ${hhmm()}`);
      await deps.notify.answerCallback(cb.id, { text: "Gönderildi" });
      await deps.events.log(eventTag(pending, "sent"), lead.id, {
        pendingId: pending.id,
        draftId: pending.gmailDraftId,
      });
    } catch (e) {
      // E8: send fail. Pending zaten 'resolved' — re-tap çalışmaz.
      // Kurucu Gmail Drafts'tan manuel atabilir (draft hala orada).
      const err = e as Error;
      await editStatus(
        pending,
        "❌ Gönderim başarısız — kurucu Gmail'den manuel atsın",
      );
      await deps.notify.answerCallback(cb.id, {
        text: "Gönderim başarısız",
        alert: true,
      });
      await deps.events.log("send_draft_send_failed", lead.id, {
        pendingId: pending.id,
        error: err.message,
      });
    }
  }

  async function handleCancelDraft(
    pending: PendingAction,
    cb: TelegramCallbackQuery,
  ): Promise<void> {
    // CAS resolve('cancelled') — double-tap atomic.
    const claimed = await deps.pendingActions.resolve(pending.id, "cancelled");
    if (!claimed) {
      await deps.notify.answerCallback(cb.id, { text: "Zaten yapıldı" });
      return;
    }

    // Best-effort: Gmail draft'ı sil. Hata olursa pending zaten 'cancelled'.
    if (pending.gmailDraftId) {
      try {
        await deps.mail.deleteDraft(pending.gmailDraftId);
      } catch (e) {
        await deps.events.log("send_draft_delete_failed", pending.leadId, {
          pendingId: pending.id,
          draftId: pending.gmailDraftId,
          error: (e as Error).message,
        });
      }
    }

    await editStatus(pending, `❌ İptal edildi ${hhmm()}`);
    await deps.notify.answerCallback(cb.id, { text: "İptal edildi" });
    await deps.events.log(eventTag(pending, "cancelled"), pending.leadId, {
      pendingId: pending.id,
    });
  }

  return { handle };
}

export type TelegramCallbackService = ReturnType<typeof createTelegramCallbackService>;
