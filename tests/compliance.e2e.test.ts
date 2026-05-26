import { describe, it, expect } from "vitest";
import { createOutboundService, type OutboundDeps } from "@/lib/services/outbound";
import { createInboundService, type InboundDeps } from "@/lib/services/inbound";
import { BRAND } from "@/lib/config/runtime";
import type { Lead, SequenceState, InboundMessage } from "@/lib/domain/types";
import type { Classification } from "@/lib/domain/enums";

// Uçtan uca uyumluluk: cold opt-out → cikis → suppression → tekrar gönderim YOK.
// Gerçek servisler + gerçek guardrail'ler; paylaşılan in-memory durum.

const lead: Lead = {
  id: "1",
  kurumAdi: "Test Poliklinik",
  sehir: "İzmir",
  tur: "poliklinik",
  vetSayisi: 4,
  segment: "mid",
  tier: 1,
  email: "x@y.com",
  emailConfidence: null,
  website: null,
  placeId: null,
  phone: null,
  instagram: null,
  kararVerici: null,
  kaynak: null,
  durum: "yeni",
  gmailThreadId: "t1",
  alternateEmails: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const suppressionSet = new Set<string>();
const seqStore = new Map<string, SequenceState>([
  ["1", { leadId: "1", currentStep: 0, nextActionAt: new Date(0), lastSentAt: null, status: "active" }],
]);
const durum = { value: lead.durum };
const drafts: Array<{ to: string; body: string }> = [];
let inboundQueue: InboundMessage[] = [];
let classifyResult: { cls: Classification; confidence: number } = { cls: "cikis", confidence: 0.95 };

const leads = {
  dueForSend: async (now: Date, tiers: number[]) => {
    const s = seqStore.get("1")!;
    const due = s.status === "active" && s.nextActionAt !== null && s.nextActionAt <= now;
    return due && tiers.includes(lead.tier) && lead.email
      ? [{ ...lead, durum: durum.value, seq: s }]
      : [];
  },
  byEmail: async (e: string) => (e.toLowerCase() === lead.email ? { ...lead, durum: durum.value } : null),
  byThread: async (t: string) => (t === lead.gmailThreadId ? { ...lead, durum: durum.value } : null),
  byId: async () => ({ ...lead, durum: durum.value }),
  upsertByEmail: async () => ({ ...lead }),
  updateDurum: async (_id: string, d: typeof durum.value) => {
    durum.value = d;
  },
  setThread: async () => {},
  upsertCandidate: async () => ({ ...lead }),
  listByDurum: async () => [],
  setEmail: async () => {},
  byDomain: async () => null,
  addAlternateEmail: async () => {},
};

const seq = {
  get: async () => seqStore.get("1") ?? null,
  save: async (s: SequenceState) => {
    seqStore.set(s.leadId, s);
  },
  create: async (id: string) => {
    const s: SequenceState = {
      leadId: id,
      currentStep: 0,
      nextActionAt: new Date(),
      lastSentAt: null,
      status: "active",
    };
    seqStore.set(id, s);
    return s;
  },
};

const supp = {
  has: async (e: string) => suppressionSet.has(e.toLowerCase().trim()),
  add: async (e: string) => {
    suppressionSet.add(e.toLowerCase().trim());
  },
};

const msgs = { add: async () => ({}) as never, existsInbound: async () => false };
const events = { log: async () => {} };

const mail = {
  createDraft: async (threadId: string | null, to: string, _subject: string, body: string) => {
    drafts.push({ to, body });
    return { id: `d${drafts.length}`, threadId: threadId ?? "t1" };
  },
  send: async () => "m1",
  addLabel: async () => {},
  listRecentInbound: async () => inboundQueue,
  watch: async () => ({ historyId: "1", expiration: 0 }),
};

const ai = {
  writeDraft: async () => ({ subject: "Konu", body: "Kısa bir demo ayarlayalım mı?" }),
  classify: async () => classifyResult,
};

const notify = { hot: async () => {} };

const outbound = createOutboundService({
  leads,
  seq,
  supp,
  msgs,
  events,
  mail,
  ai,
} as unknown as OutboundDeps);

const inbound = createInboundService({
  leads,
  seq,
  supp,
  msgs,
  events,
  mail,
  ai,
  notify,
} as unknown as InboundDeps);

describe("uyumluluk e2e", () => {
  it("1) cold outbound her zaman opt-out satırı içerir", async () => {
    const r = await outbound.processDue(new Date());
    expect(r.sent).toBe(1);
    expect(drafts.at(-1)!.body).toContain(BRAND.optOutText);
  });

  it("2) cikis cevabı → suppression + sekans durur + durum cikti", async () => {
    inboundQueue = [
      {
        gmailMessageId: "g1",
        threadId: "t1",
        fromEmail: "x@y.com",
        subject: "Re",
        body: "Lütfen beni listeden çıkarın.",
        receivedAt: new Date(),
        headerMessageId: "<g1@y.com>",
      },
    ];
    classifyResult = { cls: "cikis", confidence: 0.95 };
    await inbound.handle();
    expect(suppressionSet.has("x@y.com")).toBe(true);
    expect(seqStore.get("1")!.status).toBe("stopped_optout");
    expect(durum.value).toBe("cikti");
  });

  it("3) suppression sonrası outbound engellenir (tekrar gönderim YOK)", async () => {
    // Kasıtlı: sekansı tekrar aktif yap (guardrail belt-and-suspenders testi).
    seqStore.set("1", {
      leadId: "1",
      currentStep: 0,
      nextActionAt: new Date(0),
      lastSentAt: null,
      status: "active",
    });
    durum.value = "yeni";
    const before = drafts.length;
    const r = await outbound.processDue(new Date());
    expect(r.blocked).toBe(1);
    expect(r.sent).toBe(0);
    expect(drafts.length).toBe(before); // yeni taslak oluşmadı
  });
});
