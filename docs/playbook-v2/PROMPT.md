# PROMPT — Playbook v2 (Single-Shot Claude Code)

> **Kullanım:** Bu dosyayı `## ROL` satırından sonuna kadar **olduğu gibi** Claude Code oturumuna yapıştır. AI 5 thematic task'i (TG1-TG5) tek oturumda yürütür.
> **Hedef branch:** `feat/playbook-v2` (oluştur, dön).
> **Beklenen LOC değişimi:** ~250-350 satır (ekleme + değişiklik) + ~150 satır test.

---

## ROL

Sen, **`saas-seller`** projesinde (Vethane TR veteriner işletme yönetimi SaaS'ı için çift-modlu, insan-onaylı, Gmail-yerel AI satış ajanı) çalışan, deneyimli bir senior TypeScript geliştiricisin. Proje Next.js 16 App Router + Drizzle ORM + Neon Postgres + AI SDK v6 (Vercel AI Gateway, Haiku/Gemini) stack'inde.

Görevin: aşağıdaki 5 thematic task'i (TG1-TG5) **belirtilen sırada** yürütmek. Her task'in **dosya listesi, kod örnekleri ve acceptance criteria**'sı tam verildi. AC'ler net testler — `pnpm test` ile doğrulayacaksın. Tipler `pnpm typecheck`, kalite `pnpm lint` ile.

**KISITLAR (uy):**
- Mevcut SPEC/IMPL/Outbound akışına dokunma. Sadece **inbound + config + segment routing + lead merge** kapsamında.
- Guardrail'lere dokunma (`lib/guardrails/*` korunur — mid/hospital fiyat yasağı + suppression + opt-out doğru çalışıyor).
- AI model seçimini değiştirme (`MODELS.draft = "google/gemini-2.5-flash"`, `MODELS.classify = "anthropic/claude-haiku-4-5"`).
- Action modes'a dokunma (`ACTION_MODES`); sadece TG2'de **runtime confidence check** eklenir.
- Asla emoji ekleme (Telegram bildirimlerinde mevcut emoji'ler korunur — örnek `🔥 DEMO İSTEĞİ` zaten var; yenisi ekleme).
- `any` kullanma; tüm tipler explicit. Test fixture'larda `as unknown as` dökümü kabul edilebilir (mock şeritleri için).

**ÇIKTI:**
- Yeni branch: `feat/playbook-v2`.
- Her task ayrı commit; commit mesaj prefix: `feat(playbook-v2):`. (Tek-commit alternatifi de olur ama önerilmez.)
- Final: `pnpm lint && pnpm typecheck && pnpm test` sıfır hata + sıfır warning.

---

## TASK SIRASI

**TG4 (foundation) → TG1 → TG2 → TG3 → TG5.** TG4 önce, çünkü `Lead.alternateEmails: string[]` tip sweep'i tüm fixture'ları etkiliyor; sonra yapılırsa TG1 fixture'larını tekrar gezmek gerek.

---

## TG4 — Lead Merge + alternateEmails

### Hedef

Aynı kurumun farklı email'leriyle gelen inbound'da yeni lead **yaratma**; mevcut lead'in `alternateEmails` array'ine yeni email'i ekle. Free-mail domain'leri (gmail/hotmail/yahoo/outlook/icloud) hariç tut.

### Dosyalar

**1. `lib/db/schema.ts` — `leads` tablosuna field ekle**

```ts
// Mevcut leads tablosu içine, kurumAdi'nin altına eklenebilir:
alternateEmails: text("alternate_emails").array().notNull().default([]),
```

**2. Migration üret**

```bash
pnpm drizzle-kit generate
```

Dosya beklenen: `drizzle/0002_<random>.sql`. İçerik şuna benzer olmalı:

```sql
ALTER TABLE "leads" ADD COLUMN "alternate_emails" text[] DEFAULT '{}' NOT NULL;
```

Üretilmezse manuel oluştur.

**3. `lib/domain/types.ts` — `Lead`'e ekle**

`Lead` interface'inde (mevcut 17-37 satır arası) yeni alan:

```ts
alternateEmails: string[];
```

**4. `lib/db/mappers.ts` — `toLead` mapper'da taşı**

```ts
// toLead fonksiyonunda
alternateEmails: row.alternateEmails ?? [],
```

**5. `lib/util/email-parse.ts` — Free-mail yardımcıları**

Mevcut dosyaya ekle (üzerine yazma; sona):

```ts
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.com.tr", "outlook.com", "outlook.com.tr",
  "live.com", "windowslive.com", "msn.com",
  "yahoo.com", "yahoo.com.tr", "ymail.com",
  "icloud.com", "me.com", "mac.com",
  "mynet.com", "mynet.com.tr",
  "aol.com",
  "protonmail.com", "proton.me",
]);

export function emailDomain(email: string): string | null {
  const idx = email.indexOf("@");
  if (idx < 0) return null;
  return email.slice(idx + 1).toLowerCase();
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}
```

**6. `lib/domain/ports.ts` — `LeadRepo` arayüzü genişle**

```ts
export interface LeadRepo {
  // ... mevcut method'lar
  byDomain(domain: string): Promise<Lead | null>;
  addAlternateEmail(id: string, email: string): Promise<void>;
}
```

**7. `lib/db/repositories/lead.ts` — Implementasyon**

`sql` template'i import et (mevcut `import { and, eq, lte, inArray, isNotNull, asc } from "drizzle-orm";` satırına `sql` ekle).

`leadRepo` objesine ekle:

```ts
async byDomain(domain: string) {
  const d = domain.toLowerCase();
  const rows = await db
    .select()
    .from(leads)
    .where(
      sql`(${leads.email} LIKE ${"%@" + d})
          OR EXISTS (
            SELECT 1 FROM unnest(${leads.alternateEmails}) AS ae
            WHERE ae LIKE ${"%@" + d}
          )`,
    )
    .limit(1);
  return rows[0] ? toLead(rows[0]) : null;
},

async addAlternateEmail(id: string, email: string) {
  const e = norm(email);
  await db
    .update(leads)
    .set({
      alternateEmails: sql`CASE
        WHEN ${e} = ANY(${leads.alternateEmails}) THEN ${leads.alternateEmails}
        ELSE array_append(${leads.alternateEmails}, ${e})
      END`,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id));
},
```

**8. `lib/services/inbound.ts:47-58` — Birleşme dalı**

Üst kısma import ekle:
```ts
import { emailDomain, isFreeMailDomain } from "../util/email-parse";
```

`if (!lead) { ... }` bloğunu tamamen değiştir:

```ts
if (!lead) {
  const domain = emailDomain(msg.fromEmail);
  if (domain && !isFreeMailDomain(domain)) {
    const existing = await deps.leads.byDomain(domain);
    if (existing) {
      await deps.leads.addAlternateEmail(existing.id, msg.fromEmail);
      lead = { ...existing, alternateEmails: [...existing.alternateEmails, msg.fromEmail.toLowerCase()] };
      await deps.events.log("inbound_lead_merged", lead.id, {
        from: msg.fromEmail, matchedDomain: domain,
      });
    }
  }
  if (!lead) {
    lead = await deps.leads.upsertByEmail({
      email: msg.fromEmail,
      kurumAdi: `Web inbound — ${msg.fromEmail}`,
      segment: "unknown",
      durum: "yeni",
      kaynak: "inbound",
    });
    await deps.events.log("inbound_new_lead", lead.id, { from: msg.fromEmail, cls: cls.cls });
    await deps.notify.hot(`🆕 Web inbound — ${cls.cls}`, lead, msg);
  }
}
```

**9. TS sweep — Tüm Lead fixture'larına `alternateEmails: []`**

Etkilenen test dosyaları (typecheck'in işaret edeceği yerler):
- `tests/inbound.test.ts:6-28` (`makeLead`)
- `tests/playbooks.test.ts:6-28` (`lead`)
- Diğerlerinde de Lead instantiate varsa (örn. outbound.test.ts).

Her birinde Lead nesnesine `alternateEmails: []` ekle.

**10. Yeni test: `tests/inbound-merge.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createInboundService, type InboundDeps } from "@/lib/services/inbound";

const baseLead = (id: string, email: string, alternates: string[] = []) => ({
  id, kurumAdi: "X Polikliniği", sehir: null, tur: null, vetSayisi: null,
  segment: "mid" as const, tier: 1 as const,
  email, emailConfidence: null, website: null, placeId: null,
  phone: null, instagram: null, kararVerici: null, kaynak: null,
  durum: "sekansta" as const, gmailThreadId: null,
  createdAt: new Date(), updatedAt: new Date(),
  alternateEmails: alternates,
});

const corporateMsg = {
  gmailMessageId: "m1", threadId: "t1",
  fromEmail: "info@x-poliklinigi.com.tr",
  subject: "Soru", body: "Hangi modülleri sunuyorsunuz?", receivedAt: new Date(),
};

function makeDeps(byEmailResult: any, byDomainResult: any, msg: any = corporateMsg) {
  return {
    leads: {
      byThread: vi.fn().mockResolvedValue(null),
      byEmail: vi.fn().mockResolvedValue(byEmailResult),
      byDomain: vi.fn().mockResolvedValue(byDomainResult),
      addAlternateEmail: vi.fn().mockResolvedValue(undefined),
      upsertByEmail: vi.fn().mockResolvedValue(baseLead("new", msg.fromEmail)),
      updateDurum: vi.fn(), setThread: vi.fn(), dueForSend: vi.fn(), byId: vi.fn(),
    },
    seq: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), create: vi.fn() },
    supp: { has: vi.fn().mockResolvedValue(false), add: vi.fn() },
    msgs: { add: vi.fn(), existsInbound: vi.fn().mockResolvedValue(false) },
    events: { log: vi.fn() },
    mail: {
      listRecentInbound: vi.fn().mockResolvedValue([msg]),
      createDraft: vi.fn().mockResolvedValue({ id: "d1", threadId: "t1" }),
      send: vi.fn(), addLabel: vi.fn(), watch: vi.fn(),
    },
    ai: {
      classify: vi.fn().mockResolvedValue({ cls: "fiyat", confidence: 0.9 }),
      writeDraft: vi.fn().mockResolvedValue({ subject: "Re", body: "yanıt" }),
    },
    notify: { hot: vi.fn() },
  };
}

describe("inbound — lead merge", () => {
  it("kurumsal domain match → mevcut lead'e alternateEmail eklenir, yeni lead yaratılmaz", async () => {
    const existing = baseLead("L1", "owner@x-poliklinigi.com.tr");
    const deps = makeDeps(null, existing);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.addAlternateEmail).toHaveBeenCalledWith("L1", "info@x-poliklinigi.com.tr");
    expect(deps.leads.upsertByEmail).not.toHaveBeenCalled();
    expect(deps.events.log).toHaveBeenCalledWith("inbound_lead_merged", "L1", expect.any(Object));
  });

  it("free-mail domain (gmail) → merge denenmez, yeni lead yaratılır", async () => {
    const freeMailMsg = { ...corporateMsg, fromEmail: "klinik@gmail.com" };
    const deps = makeDeps(null, null, freeMailMsg);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.byDomain).not.toHaveBeenCalled();
    expect(deps.leads.upsertByEmail).toHaveBeenCalled();
  });

  it("kurumsal domain ama mevcut lead yok → yeni lead yaratılır", async () => {
    const deps = makeDeps(null, null);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.byDomain).toHaveBeenCalledWith("x-poliklinigi.com.tr");
    expect(deps.leads.upsertByEmail).toHaveBeenCalled();
  });
});
```

### Doğrulama

```bash
pnpm drizzle-kit generate  # 0002 migration üretildi
pnpm typecheck              # Lead.alternateEmails tüm fixture'lara eklendi
pnpm test tests/inbound-merge.test.ts  # 3 senaryo geçer
```

### Commit

```
feat(playbook-v2): TG4 lead merge + alternateEmails

- leads.alternateEmails text[] migration
- LeadRepo.byDomain + addAlternateEmail
- services/inbound: domain-match birleşmesi (free-mail dışı)
- tests/inbound-merge.test.ts
```

---

## TG1 — Playbook Routing v2

### Hedef

3 değişiklik:
1. `lib/util/segment.ts` — tür-öncelikli segment kuralı (CONTEXT.md §3 hizalı).
2. Web inbound + fiyat sorusu için premium detection → doğru playbook'a route.
3. Yeni classification `satis_spami` — no-op + düşük öncelik.

### Dosyalar

**1. `lib/util/segment.ts` — FULL REPLACE**

```ts
import type { Segment, KurumTur, Tier } from "../domain/enums";

/**
 * Segment türetme (SPEC §3.1.2 — 2026-05-26 tür-öncelikli güncelleme).
 * Tür ünvanı varsa her zaman önce o; vet sayısı sadece tür içinde refine eder.
 */
export function deriveSegment(
  vetSayisi: number | null | undefined,
  tur: KurumTur | null | undefined,
): Segment {
  if (tur === "hastane") return "hospital";
  if (tur === "poliklinik") {
    return vetSayisi != null && vetSayisi >= 6 ? "hospital" : "mid";
  }
  if (tur === "muayenehane") {
    if (vetSayisi == null) return "solo";
    return vetSayisi >= 3 ? "mid" : "solo";
  }
  if (vetSayisi != null && vetSayisi > 0) {
    if (vetSayisi >= 6) return "hospital";
    if (vetSayisi >= 3) return "mid";
    return "solo";
  }
  return "unknown";
}

export function deriveTier(segment: Segment, tur: KurumTur | null | undefined): Tier {
  if (tur === "poliklinik" || tur === "hastane") return 1;
  if (tur === "muayenehane") return segment === "solo" ? 3 : 2;
  if (segment === "hospital" || segment === "mid") return 1;
  return 3;
}
```

**2. `lib/domain/enums.ts` — `satis_spami` ekle**

```ts
export const CLASSIFICATIONS = [
  "fiyat", "demo", "ilgili", "ilgisiz", "oto_yanit", "cikis", "satis_spami",
] as const;
```

**3. Drizzle migration: Postgres enum'a değer ekle**

`pnpm drizzle-kit generate` üretebilir. Üretmezse manuel:

```sql
-- drizzle/0003_<...>.sql
ALTER TYPE classification ADD VALUE 'satis_spami';
```

**4. `lib/adapters/ai.ts` — Classify prompt**

`CLASSIFY_SYSTEM` (satır 21-29) güncelle:

```ts
const CLASSIFY_SYSTEM = `Sen, satış outreach'ine gelen e-posta cevaplarını sınıflayan bir asistansın (Türkçe).
Sınıflar:
- fiyat: fiyat/ücret/maliyet soruyor
- demo: demo, görüşme, sunum veya tanıtım istiyor
- ilgili: olumlu/ilgili ama net demo veya fiyat talebi yok
- ilgisiz: ilgilenmiyor / kibar ret (çıkış talebi DEĞİL)
- oto_yanit: otomatik yanıt (ofis dışı, tatil, no-reply)
- cikis: listeden çıkmak, "dur", spam şikâyeti, abonelikten çık
- satis_spami: Vethane veteriner bağlamı dışında başka bir ürün/servis pazarlayan cold mail
  (ör. başka SaaS demo daveti, ajans pitch, backlink takası). Lead'le ilgili DEĞİL.
confidence: 0-1 güven. segmentGuess: imza/içerikten klinik büyüklüğü tahmini (varsa).`;
```

`classify` method'unda prompt'a `fromEmail` ekle:

```ts
async classify(msg) {
  try {
    const { object } = await retry(() =>
      generateObject({
        model: MODELS.classify,
        schema: ClassificationSchema,
        system: CLASSIFY_SYSTEM,
        prompt: `Gönderen: ${msg.fromEmail}\nKonu: ${msg.subject}\n\nMesaj:\n${msg.body}`,
      }),
    );
    return object;
  } catch (e) {
    throw new AiError("sınıflama başarısız", e);
  }
},
```

**5. `lib/playbooks/index.ts` — Yeni helper + buildReply imza değişikliği**

Üst imports'a ekle:
```ts
import type { ClassificationResult } from "../domain/schemas";
import type { InboundMessage } from "../domain/types";  // (zaten varsa skip)
```

Mevcut `Playbook` interface'i güncelle:
```ts
export interface Playbook {
  segment: Segment;
  buildOutbound(lead: Lead, step: number): DraftSpec;
  buildReply(lead: Lead, msg: InboundMessage, cls: ClassificationResult): ReplyPlan;
}
```

Premium detection helper (`soloPriceText` fonksiyonunun **altına** ekle, export et):

```ts
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
```

`commonReply` — `satis_spami` dalı ekle (mevcut function'ın **return null** satırının üstüne):

```ts
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
```

`buildReplyFor` — imza ve unknown+fiyat dalı:

```ts
function buildReplyFor(
  segment: Segment,
  lead: Lead,
  msg: InboundMessage,
  cls: ClassificationResult,
): ReplyPlan {
  const common = commonReply(cls.cls);
  if (common) return common;

  // YENİ: web inbound + unknown + fiyat → premium detection
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

  // Mevcut solo dalı — değişmez
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

  // mid / hospital — değişmez
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
```

`makePlaybook` factory imzayı güncelle:

```ts
function makePlaybook(segment: Segment): Playbook {
  return {
    segment,
    buildOutbound: (_lead, step) => buildOutboundFor(segment, step),
    buildReply: (lead, msg, cls) => buildReplyFor(segment, lead, msg, cls),
  };
}
```

**6. `lib/services/inbound.ts:72` — buildReply çağrısı**

```ts
// ÖNCE:
const plan = playbookFor(segment).buildReply(lead, msg, cls.cls);

// SONRA:
const plan = playbookFor(segment).buildReply(lead, msg, cls);
```

**7. `lib/config/playbooks.ts` — Mesajları güncelle**

`solo.fiyatReply.guidance`:
```ts
fiyatReply: {
  goal: "Açık fiyatı ver + vet sayısı sor.",
  guidance:
    "Fiyatı NET ve config'ten gelen rakamla ver (uydurma). KDV hariç olduğunu belirt. " +
    "priceText doktor sayısı bilinmiyorsa 1 ve 2 vet için iki örnek içerir — onu olduğu gibi aktar. " +
    "Sonda doğru fiyatlandırma için klinikte kaç veteriner ile çalıştıklarını sor: " +
    "'Doğru fiyatlandırma için klinikte kaç veteriner ile çalıştığınızı öğrenebilir miyim?' " +
    "Deneme linki, trial URL veya site adresi BAHSETME.",
},
```

`mid.reply.guidance` (ADR-0005 hizalı):
```ts
reply: {
  goal: "Cevaba göre 2-adımlı satışa yönlendir (önce demo, sonra teklif). FİYAT YOK.",
  guidance:
    "Fiyat sorulursa: 'Klinik büyüklüğüne göre değişiyor. 20 dk'lık bir demoda sistemi göstereyim; " +
    "ardından, ne kadar arka-ofis yükünüz olduğunu birlikte gözden geçirip teklifi ayrı bir görüşmede sunarım.' " +
    `İlk demoda harcama sorma/teklif verme; o ayrı bir görüşme. Keşif sorusu: "${DISCOVERY_QUESTION}"`,
},
```

`hospital.reply.guidance`:
```ts
reply: {
  goal: "2-adımlı satışa yönlendir (demo → ayrı teklif görüşmesi). FİYAT YOK.",
  guidance:
    "Fiyat sorulursa demoya yönlendir, sayı verme. Demo = sistem gösterimi; teklif demo SONRASI " +
    "ayrı görüşmede. " +
    `Keşif: "${DISCOVERY_QUESTION}"`,
},
```

**8. Test güncellemeleri**

`tests/segment.test.ts`'e ekle:
```ts
it("hastane ünvanı + 2 vet → hospital (tür-öncelikli)", () => {
  expect(deriveSegment(2, "hastane")).toBe("hospital");
});
it("muayenehane + 3 vet → mid", () => {
  expect(deriveSegment(3, "muayenehane")).toBe("mid");
});
it("muayenehane + null vet → solo", () => {
  expect(deriveSegment(null, "muayenehane")).toBe("solo");
});
it("poliklinik + 5 vet → mid", () => {
  expect(deriveSegment(5, "poliklinik")).toBe("mid");
});
it("poliklinik + 6 vet → hospital", () => {
  expect(deriveSegment(6, "poliklinik")).toBe("hospital");
});
```

`tests/playbooks.test.ts` — mevcut `lead` helper'ı `alternateEmails: []` içermeli (TG4'ten gelmeli). Yeni testler ekle:

```ts
import type { ClassificationResult } from "@/lib/domain/schemas";

const clsResult = (cls: Classification, segmentGuess?: Segment, confidence = 0.9): ClassificationResult =>
  ({ cls, confidence, segmentGuess });

describe("playbook — unknown + fiyat (premium detection)", () => {
  it("unknown + fiyat + keyword hastane → mid playbook (fiyat YOK)", () => {
    const l = lead("solo"); l.segment = "unknown"; l.kurumAdi = "X Hayvan Hastanesi";
    const r = playbookFor("unknown").buildReply(l, msg, clsResult("fiyat"));
    expect(r.action).toBe("mid_reply");
    expect(r.priceText).toBeUndefined();
    expect(r.notify).toBe(true);
  });

  it("unknown + fiyat + AI segmentGuess mid → mid playbook", () => {
    const l = lead("solo"); l.segment = "unknown"; l.kurumAdi = "Vet Kliniği";
    const r = playbookFor("unknown").buildReply(l, msg, clsResult("fiyat", "mid"));
    expect(r.action).toBe("mid_reply");
    expect(r.notify).toBe(true);
  });

  it("unknown + fiyat + sinyal yok → solo playbook (fiyat verir)", () => {
    const l = lead("solo"); l.segment = "unknown"; l.kurumAdi = "Pati Vet";
    const r = playbookFor("unknown").buildReply(l, msg, clsResult("fiyat"));
    expect(r.action).toBe("solo_fiyat");
    expect(r.includePrice).toBe(true);
    expect(r.priceText).toMatch(/₺/);
    expect(r.notify).toBe(true);
  });
});

describe("playbook — satis_spami", () => {
  it("satis_spami → sendDraft false, notify false, durum kaybedildi", () => {
    const r = playbookFor("mid").buildReply(lead("mid"), msg, clsResult("satis_spami"));
    expect(r.sendDraft).toBe(false);
    expect(r.notify).toBe(false);
    expect(r.newDurum).toBe("kaybedildi");
    expect(r.stopSequence).toBe(true);
  });
});
```

`tests/inbound.test.ts` — `makeDeps` içinde `ai.classify` mock'unu tam objesi döndürür (mevcut zaten öyle: `{ cls, confidence, segmentGuess }`). Bu task'te değişiklik gerekmez (buildReply çağrısı tam cls obje alır).

### Doğrulama

```bash
pnpm typecheck   # imza değişikliği — fixture'lar TG4'te güncellendi
pnpm test tests/segment.test.ts tests/playbooks.test.ts tests/inbound.test.ts
```

### Commit

```
feat(playbook-v2): TG1 routing v2 (segment kuralı + premium detection + satis_spami)

- segment.ts: tür-öncelikli (HASTANE her zaman hospital)
- playbooks: detectPremiumSignal + unknown+fiyat dallanma
- satis_spami classification + commonReply no-op dalı
- ai.ts: classify prompt fromEmail + satis_spami örneği
- playbooks.ts: ADR-0005 hizalı mid/hospital/solo guidance
```

---

## TG2 — Low-Confidence Override

### Hedef

`cls.confidence < 0.5` ise auto-mode bypass; taslak draft kalır, send YAPMAZ.

### Dosyalar

**1. `lib/services/inbound.ts:140`**

```ts
// ÖNCE:
const auto = ACTION_MODES[plan.action] === "auto";

// SONRA:
const auto = ACTION_MODES[plan.action] === "auto" && cls.confidence >= CONF_THRESHOLD;
```

**2. `tests/inbound.test.ts`'e ekle**

```ts
it("düşük confidence (<0.5) → auto-mode bypass, mail.send çağrılmaz", async () => {
  const deps = makeDeps({
    cls: "fiyat",
    confidence: 0.3,
    segment: "solo",
    aiBody: "Aylık taban 1.950 ₺ + KDV...",
  });
  await run(deps);
  expect(deps.mail.createDraft).toHaveBeenCalled();
  expect(deps.mail.send).not.toHaveBeenCalled();
  expect(deps.notify.hot).toHaveBeenCalled();  // "❓ Belirsiz cevap" bildirimi
});
```

### Doğrulama

```bash
pnpm test tests/inbound.test.ts
```

### Commit

```
feat(playbook-v2): TG2 low-confidence auto-mode override

- inbound.ts:140 auto koşuluna confidence >= CONF_THRESHOLD eklendi
- Düşük confidence'da taslak kuyrukta kalır, manuel onay bekler
```

---

## TG3 — Notify Enrichment

### Hedef

Telegram bildiriminde sender, AI confidence, segmentGuess, premium keyword match göster.

### Dosyalar

**1. `lib/services/notify.ts` — FULL REPLACE**

```ts
import type { NotifyPort } from "../domain/ports";
import type { Lead, InboundMessage } from "../domain/types";
import type { ClassificationResult } from "../domain/schemas";

export interface NotifyEnrichment {
  cls?: ClassificationResult;
  premiumMatch?: boolean;
}

export interface NotifyService {
  hot(label: string, lead: Lead, msg: InboundMessage, enrich?: NotifyEnrichment): Promise<void>;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function format(label: string, lead: Lead, msg: InboundMessage, e?: NotifyEnrichment): string {
  const link = lead.gmailThreadId
    ? `https://mail.google.com/mail/u/0/#all/${lead.gmailThreadId}`
    : "(thread linki yok)";
  const lines = [
    label,
    `Gönderen: ${msg.fromEmail}`,
    `Klinik: ${lead.kurumAdi}${lead.sehir ? ` (${lead.sehir})` : ""}`,
    `Segment: ${lead.segment} · Tier ${lead.tier}`,
  ];
  if (e?.cls) {
    lines.push(
      `AI: cls=${e.cls.cls}, confidence=${e.cls.confidence.toFixed(2)}` +
      (e.cls.segmentGuess ? `, segmentGuess=${e.cls.segmentGuess}` : "")
    );
  }
  if (e?.premiumMatch != null) {
    lines.push(`Premium sinyal: ${e.premiumMatch ? "VAR" : "yok"}`);
  }
  lines.push(`Konu: ${msg.subject}`);
  lines.push(`Mesaj: ${truncate(msg.body.trim(), 280)}`);
  lines.push(`Gmail: ${link}`);
  return lines.join("\n");
}

export function createNotifyService(port: NotifyPort): NotifyService {
  return {
    async hot(label, lead, msg, enrich) {
      try {
        await port.notify(format(label, lead, msg, enrich));
      } catch {
        /* bildirim best-effort */
      }
    },
  };
}
```

**2. `lib/services/inbound.ts` — 3 `notify.hot` çağrısını zenginleştir**

Üst kısma import (TG1'den sonra `detectPremiumSignal` export edildi):
```ts
import { detectPremiumSignal } from "../playbooks";
import type { NotifyEnrichment } from "./notify";
```

`inbound_new_lead` notify (TG4'te yazdığın blok içinde):
```ts
await deps.notify.hot(`🆕 Web inbound — ${cls.cls}`, lead, msg, { cls });
```

`Belirsiz cevap` notify (mevcut satır 84):
```ts
if (cls.confidence < CONF_THRESHOLD) {
  await deps.notify.hot("❓ Belirsiz cevap — elle bak", lead, msg, { cls });
}
```

`plan.notify` çağrısı (mevcut satır 98-101):
```ts
if (plan.notify) {
  const label = cls.cls === "demo" ? "🔥 DEMO İSTEĞİ" : "🔥 Premium/ilgili yanıt";
  const enrich: NotifyEnrichment = {
    cls,
    premiumMatch: segment === "unknown" ? detectPremiumSignal({ lead, msg, cls }) : undefined,
  };
  await deps.notify.hot(label, lead, msg, enrich);
}
```

**3. `tests/inbound.test.ts`'e ekle**

```ts
it("notify.hot çağrısı zengin enrichment içerir (cls)", async () => {
  const deps = makeDeps({ cls: "demo", segment: "mid", confidence: 0.9 });
  await run(deps);
  expect(deps.notify.hot).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Object),
    expect.any(Object),
    expect.objectContaining({ cls: expect.objectContaining({ cls: "demo" }) }),
  );
});
```

### Doğrulama

```bash
pnpm test tests/inbound.test.ts
```

### Commit

```
feat(playbook-v2): TG3 notify enrichment

- NotifyEnrichment interface: cls + premiumMatch
- inbound.ts: 3 notify.hot çağrısı zenginleştirildi
- Telegram bildirimi: Gönderen + AI confidence + segmentGuess + Premium sinyal
```

---

## TG5 — Doc + Pricing Config

### Hedef

`docs/PRICING.md §10` 2-adımlı satışla güncellenir; `lib/config/pricing.ts`'e mid + hospital referans tabloları eklenir.

### Dosyalar

**1. `docs/PRICING.md` üst kısmı — sürüm notu ekle**

Mevcut "**Sürüm:** v3.2 ..." satırının altına ekle:

```
> v3.3 (2026-05-26) — §10 satış akışı 2-adımlı (demo → ayrı teklif görüşmesi) olarak güncellendi
> ([ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md)). Fiyat seviyeleri değişmedi.
```

**2. `docs/PRICING.md §10` — "Satış akışı (mid/hastane)" paragrafı**

Mevcut satır 219 etrafı:
```
**Satış akışı (mid/hastane):** demo → *"bugün muhasebeci + bordro + raporlamaya ne harcıyorsunuz?"* (≈ §4.1 arka-ofis maliyeti, ₺25-90k) → Vethane tek sistemde + fraksiyonuna → büyüklük bandına göre teklif.
```

Bunu şununla değiştir:

```
**Satış akışı (mid/hastane), 2-adımlı:**

**Adım 1 — Demo (sistem gösterimi):** Klinik isteyince, AI ajan demo zamanı önerir ve kurucuya
Telegram bildirir. Demo = fake-data ürün-tour'u (modüller, ekranlar, akış). **Demoda harcama
sorusu ve teklif YOKTUR.** Demo bitiminde kurucu, klinikten "teklif görüşmesi" için ayrı bir
takvim slot'u talep eder.

**Adım 2 — Teklif görüşmesi (kurucu manuel):** *"Bugün muhasebeci + bordro + vardiya +
raporlamaya ne harcıyorsunuz?"* (≈ §4.1 arka-ofis maliyeti, ₺25-90k) → Vethane tek sistemde +
fraksiyonuna → klinik büyüklük bandına göre teklif.

Bu ayrım [ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md) ile kararlaştırıldı.
Demo sürtünmesini düşürür (daha çok demo bookings); teklif görüşmesi nitelikli müşteriyle yapılır.
```

**3. `lib/config/pricing.ts` — Mid + Hospital eklemeler**

Mevcut dosyanın **sonuna** (satır 56'dan sonra) ekle:

```ts
// --- Mid bandı (3-5 vet) — Referans tablosu ---
// PRICING.md §2 v3.2 ile aynı. AI bu sayıları KULLANMAZ (guardrail mid/hospital fiyat yasağı aktif);
// kurucu referansı + ileride otomatize edilirse teklif görüşmesi için.
export const MID_PRICES = {
  taban: 3200,
  doktorPerVet: 220,
  muhasebe: 3300,
  ik: 2800,
  analitik: 2000,
  kafe: 900,
} as const;

// --- Hospital bandı (6+ vet) — Referans tablosu ---
export const HOSPITAL_PRICES = {
  taban: 5400,
  doktorPerVet: 195,
  muhasebe: 7000,
  ik: 5800,
  analitik: 4100,
  kafe: 1400,
} as const;

export type PricingModule = "muhasebe" | "ik" | "analitik" | "kafe";

interface PriceTable {
  taban: number;
  doktorPerVet: number;
  muhasebe: number;
  ik: number;
  analitik: number;
  kafe: number;
}

function calcPrice(
  table: PriceTable,
  opts: { modules: PricingModule[]; vetCount: number },
): SoloPriceResult {
  const taban = table.taban;
  const doktor = table.doktorPerVet * Math.max(0, opts.vetCount);
  const moduleSum = opts.modules.reduce((s, m) => s + table[m], 0);
  const discount = expansionDiscount(opts.modules.length);
  const modulesDiscounted = Math.round(moduleSum * (1 - discount));
  return { total: taban + doktor + modulesDiscounted, taban, doktor, moduleSum, discount, modulesDiscounted };
}

export function getMidPrice(opts: { modules: PricingModule[]; vetCount: number }): SoloPriceResult {
  return calcPrice(MID_PRICES, opts);
}

export function getHospitalPrice(opts: { modules: PricingModule[]; vetCount: number }): SoloPriceResult {
  return calcPrice(HOSPITAL_PRICES, opts);
}

// Yükleme-anı doğrulama (geçersiz config build'i kırar).
const PriceTableSchema = z.object({
  taban: z.number().positive(),
  doktorPerVet: z.number().positive(),
  muhasebe: z.number().positive(),
  ik: z.number().positive(),
  analitik: z.number().positive(),
  kafe: z.number().positive(),
});
PriceTableSchema.parse(MID_PRICES);
PriceTableSchema.parse(HOSPITAL_PRICES);
```

**4. `tests/config.test.ts`'e ekle**

```ts
import { getMidPrice, getHospitalPrice } from "@/lib/config/pricing";

describe("pricing — mid/hospital reference tables", () => {
  it("mid 4 vet + 3 modül -%10 ≈ 11.370 (PRICING.md §5)", () => {
    const r = getMidPrice({ modules: ["muhasebe", "ik", "analitik"], vetCount: 4 });
    // 3200 + 4*220 + (3300+2800+2000)*0.9 = 4080 + 7290 = 11370
    expect(r.total).toBe(11370);
  });

  it("hospital 6 vet + 4 modül -%15 ≈ 22.125 (PRICING.md §5)", () => {
    const r = getHospitalPrice({ modules: ["muhasebe", "ik", "analitik", "kafe"], vetCount: 6 });
    // 5400 + 6*195 + (7000+5800+4100+1400)*0.85 = 6570 + 15555 = 22125
    expect(r.total).toBe(22125);
  });
});
```

### Doğrulama

```bash
pnpm test tests/config.test.ts
rg "demoda.*(teklif|net|harcama)" docs/  # 0 hit beklenir
```

### Commit

```
feat(playbook-v2): TG5 doc + pricing config (mid/hospital referans)

- PRICING.md §10: 2-adımlı satış akışı (ADR-0005 hizalı)
- PRICING.md v3.3 sürüm notu
- pricing.ts: MID_PRICES + HOSPITAL_PRICES + getMidPrice + getHospitalPrice
- tests: PRICING.md §5 senaryoları doğrulandı
```

---

## FINAL DOĞRULAMA

Tüm 5 task tamamlandıktan sonra:

```bash
pnpm lint
pnpm typecheck
pnpm test

# Doc-code drift yakalama:
rg "demoda.*(teklif|net|harcama)" docs/ lib/   # 0 hit beklenir
rg "fromEmail.*domain.*segment" lib/            # 0 hit (asla domain → segment)

# Migration sırası:
ls drizzle/   # 0000_..., 0002_..., 0003_... bekleniyor
```

Beklenen test sayısı artışı: ~12-15 yeni test geçer.

PR oluştur (manuel, otomatik açma):

```bash
git push -u origin feat/playbook-v2
gh pr create --title "feat(playbook-v2): inbound routing v2 + lead merge + ADR-0005" --body "$(cat <<'EOF'
## Summary
- TG1: Playbook routing v2 — premium detection, satis_spami classification, tür-öncelikli segment
- TG2: Düşük confidence (<0.5) auto-mode override
- TG3: Telegram bildiriminde AI confidence + segmentGuess + premium sinyal
- TG4: Lead merge — aynı kurumsal domain için alternateEmails birikimi
- TG5: PRICING.md §10 2-adımlı satış (ADR-0005 hizalı) + mid/hospital referans tabloları

Refs: docs/playbook-v2/, docs/adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md, CONTEXT.md karar #2 + §3

## Test plan
- [ ] pnpm lint && pnpm typecheck && pnpm test (sıfır hata)
- [ ] tests/segment.test.ts: tür-öncelikli senaryolar (5 yeni)
- [ ] tests/playbooks.test.ts: unknown+fiyat premium detection + satis_spami (4 yeni)
- [ ] tests/inbound.test.ts: düşük confidence + notify enrichment (2 yeni)
- [ ] tests/inbound-merge.test.ts: yeni dosya (3 senaryo)
- [ ] tests/config.test.ts: mid/hospital pricing (2 yeni)
- [ ] Manuel staging: Gmail'e kurumsal domain'den test mail → lead merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## DURMA NOKTALARI

Şu durumlarda **dur ve sor**:
- Migration başarısız (`pnpm drizzle-kit generate` veya `migrate` hata verdi).
- TS sweep eksiklik bıraktı (`pnpm typecheck` 10+ hata).
- Pricing senaryosu test sonucu PRICING.md §5 ile **eşleşmedi** (11.370 / 22.125 değil).
- AI prompt'una satis_spami eklendikten sonra **eski testlerin kırıldı** (`tests/ai-prompts.test.ts` veya `tests/inbound.test.ts` mid+fiyat senaryoları).

Şu durumlarda **devam et**:
- Lint warning'lar (sıfır olmalı; 1-2 trivial varsa düzelt).
- Yeni testlerin ilk koşusunda hata (kodu tekrar oku, fixture'lar tam mı).
- Drizzle migration adı `0002`/`0003` değil farklı (drizzle-kit randomize ediyor) — sıra korunduğu sürece OK.
