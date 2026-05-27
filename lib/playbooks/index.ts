import { PLAYBOOKS } from "../config/playbooks";
import { getSoloPrice, formatTRY, SOLO_PRICES } from "../config/pricing";
import type { Segment, Classification } from "../domain/enums";
import type { Lead, InboundMessage, DraftSpec, ReplyPlan } from "../domain/types";
import type { ClassificationResult } from "../domain/schemas";

// Strategy pattern (IMPL §2.2): segment → davranış.
// KRİTİK: mid/hospital ASLA fiyat içermez (includePrice/priceText yok); solo fiyatı config'ten.

export interface Playbook {
  segment: Segment;
  buildOutbound(lead: Lead, step: number): DraftSpec;
  buildReply(lead: Lead, msg: InboundMessage, cls: ClassificationResult): ReplyPlan;
}

function soloPriceText(lead: Lead): string {
  const taban = formatTRY(SOLO_PRICES.taban);
  const vet = lead.vetSayisi;
  if (vet && vet > 0) {
    const ex = getSoloPrice({ modules: ["muhasebe"], vetCount: vet });
    return `Aylık taban ${taban}. ${vet} vet + Muhasebe modülü ≈ ${formatTRY(ex.total)}. Eklenen modüllere göre değişir. KDV hariç.`;
  }
  // Vet sayısı bilinmiyor → tek örnek (1 vet) ver, sonra vet sayısı sorulacak.
  const ex1 = getSoloPrice({ modules: ["muhasebe"], vetCount: 1 });
  return `Aylık taban ${taban}. 1 vet + Muhasebe ≈ ${formatTRY(ex1.total)}. Eklenen modüllere göre değişir. KDV hariç.`;
}

const PREMIUM_KEYWORDS = /(hastane|poliklinik|şube|merkez|zincir|grup)/i;

export function detectPremiumSignal(ctx: {
  lead: Lead;
  msg: InboundMessage;
  cls: ClassificationResult;
}): boolean {
  const text = `${ctx.lead.kurumAdi} ${ctx.msg.subject} ${ctx.msg.body}`;
  if (PREMIUM_KEYWORDS.test(text)) return true;
  if (ctx.cls.segmentGuess === "mid" || ctx.cls.segmentGuess === "hospital") return true;
  return false;
}

function buildOutboundFor(segment: Segment, step: number): DraftSpec {
  const cold = step === 0;
  if (segment === "solo") {
    const cfg = cold ? PLAYBOOKS.solo.cold : PLAYBOOKS.solo.takip;
    return {
      action: cold ? "solo_cold" : "solo_takip",
      segment: "solo",
      isCold: true,
      goal: cfg.goal,
      guidance: cfg.guidance,
    };
  }
  if (segment === "hospital") {
    const cfg = cold ? PLAYBOOKS.hospital.cold : PLAYBOOKS.hospital.takip;
    return {
      action: cold ? "hospital_cold" : "hospital_takip",
      segment: "hospital",
      isCold: true,
      goal: cfg.goal,
      guidance: cfg.guidance,
    };
  }
  // mid (+ unknown → güvenli: fiyatsız mid davranışı)
  const cfg = cold ? PLAYBOOKS.mid.cold : PLAYBOOKS.mid.takip;
  return {
    action: cold ? "mid_cold" : "mid_takip",
    segment: "mid",
    isCold: true,
    goal: cfg.goal,
    guidance: cfg.guidance,
  };
}

/** Segment-bağımsız cevaplar (demo/çıkış/ilgisiz/oto_yanit/satis_spami). */
function commonReply(cls: Classification): ReplyPlan | null {
  if (cls === "demo") {
    return {
      action: "demo_reply",
      goal: PLAYBOOKS.demoReply.goal,
      guidance: PLAYBOOKS.demoReply.guidance,
      sendDraft: true,
      notify: true,
      stopSequence: true,
      suppress: false,
      newDurum: "demo_istedi",
    };
  }
  if (cls === "cikis") {
    return {
      action: "cikis_reply",
      goal: PLAYBOOKS.cikisReply.goal,
      guidance: PLAYBOOKS.cikisReply.guidance,
      sendDraft: true,
      notify: false,
      stopSequence: true,
      suppress: true,
      newDurum: "cikti",
    };
  }
  if (cls === "ilgisiz") {
    return {
      action: "cikis_reply",
      goal: "Yanıt yok; sekansı durdur.",
      guidance: "",
      sendDraft: false,
      notify: false,
      stopSequence: true,
      suppress: false,
      newDurum: "kaybedildi",
    };
  }
  if (cls === "oto_yanit") {
    return {
      action: "cikis_reply",
      goal: "Otomatik yanıt; ertele.",
      guidance: "",
      sendDraft: false,
      notify: false,
      stopSequence: false,
      rescheduleDays: 3,
      suppress: false,
    };
  }
  if (cls === "satis_spami") {
    return {
      action: "cikis_reply",
      goal: "Satış spam'i — no-op.",
      guidance: "",
      sendDraft: false,
      notify: false,
      stopSequence: true,
      suppress: false,
      newDurum: "kaybedildi",
    };
  }
  return null; // fiyat / ilgili → segmente özel
}

function buildReplyFor(
  segment: Segment,
  lead: Lead,
  msg: InboundMessage,
  cls: ClassificationResult,
): ReplyPlan {
  const common = commonReply(cls.cls);
  if (common) return common;

  // Demo zaten onaylanmış (durum=demo_istedi) — bot susar, kurucu Telegram'dan
  // manuel takip eder. "Teşekkür ettim" / "OK" gibi mesajlara intro tekrarlamasın.
  // cikis common'da yakalandığı için bu noktaya gelmemeli; başka cls'ler sessize alınır.
  // newDurum YOK → demo_istedi state'i bozulmasın (mid_reply'ın cevap_geldi'ye düşürme bug'ı).
  if (lead.durum === "demo_istedi") {
    return {
      action: "demo_followup",
      goal: "Demo onayı sonrası takip — bot mesaj atmaz, kurucu Telegram'dan görür.",
      guidance: "",
      sendDraft: false,
      notify: true,
      stopSequence: true,
      suppress: false,
    };
  }

  // Web inbound + unknown + fiyat → premium detection (TG1)
  if (segment === "unknown" && cls.cls === "fiyat") {
    const isPremium = detectPremiumSignal({ lead, msg, cls });
    if (isPremium) {
      return {
        action: "mid_reply",
        goal: PLAYBOOKS.mid.reply.goal,
        guidance: PLAYBOOKS.mid.reply.guidance,
        sendDraft: true,
        notify: true,
        stopSequence: true,
        suppress: false,
        newDurum: "cevap_geldi",
      };
    }
    return {
      action: "solo_fiyat",
      goal: PLAYBOOKS.solo.fiyatReply.goal,
      guidance: PLAYBOOKS.solo.fiyatReply.guidance,
      sendDraft: true,
      notify: true,
      stopSequence: true,
      suppress: false,
      newDurum: "cevap_geldi",
      includePrice: true,
      priceText: soloPriceText(lead),
    };
  }

  // Kalan: fiyat, ilgili
  if (segment === "solo") {
    if (cls.cls === "fiyat") {
      return {
        action: "solo_fiyat",
        goal: PLAYBOOKS.solo.fiyatReply.goal,
        guidance: PLAYBOOKS.solo.fiyatReply.guidance,
        sendDraft: true,
        notify: false,
        stopSequence: true,
        suppress: false,
        newDurum: "cevap_geldi",
        includePrice: true,
        priceText: soloPriceText(lead),
      };
    }
    // ilgili
    return {
      action: "solo_takip",
      goal: "İlgiyi denemeye çevir.",
      guidance: PLAYBOOKS.solo.takip.guidance,
      sendDraft: true,
      notify: false,
      stopSequence: true,
      suppress: false,
      newDurum: "cevap_geldi",
    };
  }

  // mid / hospital → FİYAT YOK, demoya çek, kurucuya bildir (premium hot signal)
  const cfg = segment === "hospital" ? PLAYBOOKS.hospital.reply : PLAYBOOKS.mid.reply;
  return {
    action: segment === "hospital" ? "hospital_reply" : "mid_reply",
    goal: cfg.goal,
    guidance: cfg.guidance,
    sendDraft: true,
    notify: true,
    stopSequence: true,
    suppress: false,
    newDurum: "cevap_geldi",
  };
}

function makePlaybook(segment: Segment): Playbook {
  return {
    segment,
    buildOutbound: (_lead, step) => buildOutboundFor(segment, step),
    buildReply: (lead, msg, cls) => buildReplyFor(segment, lead, msg, cls),
  };
}

export const soloPlaybook = makePlaybook("solo");
export const midPlaybook = makePlaybook("mid");
export const hospitalPlaybook = makePlaybook("hospital");
export const unknownPlaybook = makePlaybook("unknown");

export function playbookFor(s: Segment): Playbook {
  if (s === "solo") return soloPlaybook;
  if (s === "hospital") return hospitalPlaybook;
  if (s === "unknown") return unknownPlaybook;
  return midPlaybook;
}
