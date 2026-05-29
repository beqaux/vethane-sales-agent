import { RUNTIME } from "../config/runtime";
import type { SequenceState } from "../domain/types";

// Sekans state machine (IMPL §2.4). Saf fonksiyonlar — kolay test.

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Cevap geldi → sekansı durdur. */
export function onReply(s: SequenceState): SequenceState {
  return { ...s, status: "stopped_replied", nextActionAt: null };
}

/** Çıkış (opt-out) → durdur. */
export function onOptout(s: SequenceState): SequenceState {
  return { ...s, status: "stopped_optout", nextActionAt: null };
}

/** İlgisiz → durdur (cevap gibi). */
export function onLost(s: SequenceState): SequenceState {
  return { ...s, status: "stopped_replied", nextActionAt: null };
}

/** Otomatik yanıt (OOO) → X gün ertele, aktif kalsın.
 * status'u AÇIKÇA 'active' yapar: sekans 'completed'/durmuş bir satırda erteleme
 * yapılırsa dueForSend (status='active' şartı) lead'i hiç almaz ve sıcak lead
 * sessizce düşerdi. OOO sonrası lead'i yeniden devreye al. */
export function reschedule(s: SequenceState, days: number, now: Date = new Date()): SequenceState {
  return { ...s, status: "active", nextActionAt: addDays(now, days) };
}

/** Bir dokunuş gönderildikten sonra sıradakini planla; son adımdan sonra tamamla. */
export function advance(
  s: SequenceState,
  now: Date = new Date(),
  cfg: { maxSteps: number; gapDays: number } = RUNTIME.seq,
): SequenceState {
  const next = s.currentStep + 1;
  if (next > cfg.maxSteps) {
    return { ...s, status: "completed", lastSentAt: now, nextActionAt: null };
  }
  return {
    ...s,
    currentStep: next,
    lastSentAt: now,
    nextActionAt: addDays(now, cfg.gapDays),
  };
}
