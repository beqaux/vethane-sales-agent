import { PLAYBOOKS } from "../config/playbooks";
import { BRAND } from "../config/runtime";
import { getSoloPrice, formatTRY, SOLO_PRICES } from "../config/pricing";
import type { Segment, Classification } from "../domain/enums";
import type { Lead, InboundMessage, DraftSpec, ReplyPlan } from "../domain/types";

// Strategy pattern (IMPL §2.2): segment → davranış.
// KRİTİK: mid/hospital ASLA fiyat içermez (includePrice/priceText yok); solo fiyatı config'ten.

export interface Playbook {
  segment: Segment;
  buildOutbound(lead: Lead, step: number): DraftSpec;
  buildReply(lead: Lead, msg: InboundMessage, cls: Classification): ReplyPlan;
}

function soloPriceText(lead: Lead): string {
  const taban = formatTRY(SOLO_PRICES.taban);
  const vet = lead.vetSayisi;
  if (vet && vet > 0) {
    const ex = getSoloPrice({ modules: ["muhasebe"], vetCount: vet });
    return `Aylık taban ${taban}. ${vet} vet + Muhasebe modülü ≈ ${formatTRY(ex.total)}. Eklenen modüllere göre değişir. KDV hariç.`;
  }
  // Doktor sayısı bilinmiyor → 1 ve 2 vet için örnek paylaş.
  const ex1 = getSoloPrice({ modules: ["muhasebe"], vetCount: 1 });
  const ex2 = getSoloPrice({ modules: ["muhasebe"], vetCount: 2 });
  return `Aylık taban ${taban}. 1 vet + Muhasebe ≈ ${formatTRY(ex1.total)}; 2 vet + Muhasebe ≈ ${formatTRY(ex2.total)}. Eklenen modüllere göre değişir. KDV hariç.`;
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

/** Segment-bağımsız cevaplar (demo/çıkış/ilgisiz/oto_yanit). */
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
  return null; // fiyat / ilgili → segmente özel
}

function buildReplyFor(
  segment: Segment,
  lead: Lead,
  cls: Classification,
): ReplyPlan {
  const common = commonReply(cls);
  if (common) return common;

  // Kalan: fiyat, ilgili
  if (segment === "solo") {
    if (cls === "fiyat") {
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
    buildReply: (lead, _msg, cls) => buildReplyFor(segment, lead, cls),
  };
}

export const soloPlaybook = makePlaybook("solo");
export const midPlaybook = makePlaybook("mid");
export const hospitalPlaybook = makePlaybook("hospital");

export function playbookFor(s: Segment): Playbook {
  if (s === "solo") return soloPlaybook;
  if (s === "hospital") return hospitalPlaybook;
  return midPlaybook; // mid + unknown (fiyatsız → güvenli)
}
