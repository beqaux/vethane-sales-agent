# IMPLEMENTATION — Playbook v2

> **Kapsam:** SPEC-DELTA'daki kararları **dosya-dosya** patch'lere indirir. Her edit için: dosya yolu, mevcut satır referansı, hedef davranış, kod örneği.
> **Hedef kitle:** Bu repoyu daha önce görmüş geliştirici (kod patikalarını biliyor). Yeni biri için [SPEC-DELTA](SPEC-DELTA.md) önce.

---

## 0. Önkoşullar

- Node 24, pnpm yüklü.
- Repo durumu: `main` branch clean. **Önce yeni branch aç:** `git checkout -b feat/playbook-v2`.
- `.env.local` mevcut, DB ve Gateway anahtarları çalışıyor (test'ler için DB shadow şart değil; sadece typecheck/lint/vitest test'ler şart).
- `pnpm install` (bu iterasyon yeni dependency eklemez).

Doğrulama komutu zinciri (her task sonu çalıştırılacak):

```bash
pnpm lint && pnpm typecheck && pnpm test
```

---

## 1. TG1 — Playbook Routing v2

### 1.1 `lib/util/segment.ts` — Tür-öncelikli segment kuralı

**Mevcut (satır 7-20):** vet-sayısı öncelikli. **Hedef:** tür-öncelikli.

```ts
// lib/util/segment.ts (FULL REPLACE)
import type { Segment, KurumTur, Tier } from "../domain/enums";

/**
 * Segment türetme (SPEC §3.1.2 — 2026-05-26 tür-öncelikli güncelleme).
 * Tür ünvanı varsa her zaman önce o; vet sayısı sadece tür içinde refine eder.
 */
export function deriveSegment(
  vetSayisi: number | null | undefined,
  tur: KurumTur | null | undefined,
): Segment {
  // 1. HASTANE ünvanı → her zaman hospital.
  if (tur === "hastane") return "hospital";

  // 2. POLİKLİNİK → vet >=6 hospital, else mid (yasayla ≥4 vet zaten).
  if (tur === "poliklinik") {
    return vetSayisi != null && vetSayisi >= 6 ? "hospital" : "mid";
  }

  // 3. MUAYENEHANE → ≤2 solo, =3 mid (yasayla ≤3 vet); vet bilinmiyorsa solo.
  if (tur === "muayenehane") {
    if (vetSayisi == null) return "solo";
    return vetSayisi >= 3 ? "mid" : "solo";
  }

  // 4. Tür belirsiz → vet sayısına düş.
  if (vetSayisi != null && vetSayisi > 0) {
    if (vetSayisi >= 6) return "hospital";
    if (vetSayisi >= 3) return "mid";
    return "solo";
  }
  return "unknown";
}

// deriveTier değişmiyor — mevcut kalır.
export function deriveTier(segment: Segment, tur: KurumTur | null | undefined): Tier {
  if (tur === "poliklinik" || tur === "hastane") return 1;
  if (tur === "muayenehane") return segment === "solo" ? 3 : 2;
  if (segment === "hospital" || segment === "mid") return 1;
  return 3;
}
```

**Test güncelle:** `tests/segment.test.ts`'e ekle:

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

### 1.2 `lib/playbooks/index.ts` — Premium detection routing

`commonReply` ve `buildReplyFor`'a yeni dal eklenecek.

**1.2.1 Yeni helper:** `detectPremiumSignal` — `lib/playbooks/index.ts`'in üstüne:

```ts
const PREMIUM_KEYWORDS = /(hastane|poliklinik|şube|merkez|zincir|grup)/i;

interface PremiumContext {
  lead: Lead;
  msg: InboundMessage;
  cls: ClassificationResult;  // import lib/domain/schemas.ts
}

/**
 * Web inbound + unknown segment'te lead'in premium (mid/hospital) eğiliminde
 * olup olmadığını tespit eder. Keyword > AI guess önceliği.
 * Sourcing-anı segmenti zaten varsa bu fonksiyon kullanılmaz.
 */
export function detectPremiumSignal(ctx: PremiumContext): boolean {
  const text = `${ctx.lead.kurumAdi} ${ctx.msg.subject} ${ctx.msg.body}`;
  if (PREMIUM_KEYWORDS.test(text)) return true;
  if (ctx.cls.segmentGuess === "mid" || ctx.cls.segmentGuess === "hospital") return true;
  return false;
}
```

**Import düzelt:**
```ts
import type { Lead, InboundMessage } from "../domain/types";
import type { ClassificationResult } from "../domain/schemas";
```

**1.2.2 `buildReplyFor` güncelle:** unknown + fiyat dalı eklenir.

Mevcut:
```ts
function buildReplyFor(segment: Segment, lead: Lead, cls: Classification): ReplyPlan {
```

Yeni imza — `cls` artık tam `ClassificationResult` (sadece string değil, confidence + segmentGuess'a erişim için):

```ts
function buildReplyFor(
  segment: Segment,
  lead: Lead,
  msg: InboundMessage,
  cls: ClassificationResult,
): ReplyPlan {
  const common = commonReply(cls.cls);
  if (common) return common;

  // YENİ DAL: web inbound + unknown + fiyat → premium detection
  if (segment === "unknown" && cls.cls === "fiyat") {
    const isPremium = detectPremiumSignal({ lead, msg, cls });
    if (isPremium) {
      // mid playbook
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
    // solo playbook
    return {
      action: "solo_fiyat",
      goal: PLAYBOOKS.solo.fiyatReply.goal,
      guidance: PLAYBOOKS.solo.fiyatReply.guidance,
      sendDraft: true,
      notify: true,  // YENİ: web inbound'da her zaman bildir
      stopSequence: true,
      suppress: false,
      newDurum: "cevap_geldi",
      includePrice: true,
      priceText: soloPriceText(lead),
    };
  }

  // Mevcut segment-specific dallar (değişmiyor)...
  if (segment === "solo") { /* ... */ }
  // mid / hospital → mevcut
}
```

**Önemli:** `Playbook` interface'i de güncellenmeli (`buildReply` imzası `msg` ve `cls` parametreleri tam):

```ts
export interface Playbook {
  segment: Segment;
  buildOutbound(lead: Lead, step: number): DraftSpec;
  buildReply(lead: Lead, msg: InboundMessage, cls: ClassificationResult): ReplyPlan;
}
```

`makePlaybook` ve call-site (`inbound.ts:72`) buna göre güncellenir.

**1.2.3 `commonReply`'ye `satis_spami` ekle:**

```ts
function commonReply(cls: Classification): ReplyPlan | null {
  // ... mevcut dallar
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
  return null;
}
```

### 1.3 `lib/config/playbooks.ts` — Mesaj güncellemeleri

**`solo.fiyatReply.guidance` (satır 21):**

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

**`mid.reply.guidance` (satır 35) — ADR-0005 hizalı:**

```ts
reply: {
  goal: "Cevaba göre 2-adımlı satışa yönlendir (önce demo, sonra teklif). FİYAT YOK.",
  guidance:
    "Fiyat sorulursa: 'Klinik büyüklüğüne göre değişiyor. 20 dk'lık bir demoda sistemi göstereyim; " +
    "ardından, ne kadar arka-ofis yükünüz olduğunu birlikte gözden geçirip teklifi ayrı bir görüşmede sunarım.' " +
    `İlk demoda harcama sorma/teklif verme; o ayrı bir görüşme. Keşif sorusu: "${DISCOVERY_QUESTION}"`,
},
```

**`hospital.reply.guidance` (satır 46) — benzer:**

```ts
reply: {
  goal: "2-adımlı satışa yönlendir (demo → ayrı teklif görüşmesi). FİYAT YOK.",
  guidance:
    "Fiyat sorulursa demoya yönlendir, sayı verme. Demo = sistem gösterimi; teklif demo SONRASI " +
    "ayrı görüşmede. " +
    `Keşif: "${DISCOVERY_QUESTION}"`,
},
```

### 1.4 `lib/adapters/ai.ts` — Classify prompt güncelle

**`CLASSIFY_SYSTEM` (satır 21-29) — `satis_spami` ekle:**

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

**`classify` çağrısına `fromEmail` ekle (gözlem amaçlı, segment KARARI için değil):**

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

### 1.5 `lib/domain/enums.ts` — `satis_spami` enum

```ts
export const CLASSIFICATIONS = [
  "fiyat", "demo", "ilgili", "ilgisiz", "oto_yanit", "cikis", "satis_spami",
] as const;
```

### 1.6 `lib/domain/schemas.ts` — ClassificationSchema otomatik

`z.enum(CLASSIFICATIONS)` zaten dynamic, ekstra değişiklik yok. Drizzle enum'ı da otomatik (schema.ts'te `classificationEnum = pgEnum("classification", CLASSIFICATIONS)`); ama Postgres enum'a yeni değer eklemek için **migration gerekir** (`ALTER TYPE classification ADD VALUE 'satis_spami'`).

**Drizzle migration:** `pnpm drizzle-kit generate` yeni migration üretir; manuel kontrol:

```sql
-- drizzle/0001_add_satis_spami_classification.sql
ALTER TYPE classification ADD VALUE 'satis_spami';
```

### 1.7 `lib/services/inbound.ts` — Yeni imza uyumu

`inbound.ts:72` mevcut:
```ts
const plan = playbookFor(segment).buildReply(lead, msg, cls.cls);
```

Yeni (`cls` tam objesi geçer):
```ts
const plan = playbookFor(segment).buildReply(lead, msg, cls);
```

### 1.8 Test Güncellemeleri

**`tests/playbooks.test.ts`** — yeni testler:

```ts
import type { ClassificationResult } from "@/lib/domain/schemas";

const clsResult = (cls: Classification, segmentGuess?: Segment): ClassificationResult => ({
  cls, confidence: 0.9, segmentGuess,
});

describe("playbook — unknown + fiyat (premium detection)", () => {
  it("unknown + fiyat + keyword hastane → mid playbook", () => {
    const l = lead("solo"); l.segment = "unknown"; l.kurumAdi = "X Hayvan Hastanesi";
    const m = { ...msg, body: "fiyat?" };
    const r = playbookFor("unknown").buildReply(l, m, clsResult("fiyat"));
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
    expect(r.notify).toBe(true);  // web inbound her zaman bildir
  });
});

describe("playbook — satis_spami", () => {
  it("satis_spami → no-op (sendDraft false, notify false, durum kaybedildi)", () => {
    const r = playbookFor("mid").buildReply(lead("mid"), msg, clsResult("satis_spami"));
    expect(r.sendDraft).toBe(false);
    expect(r.notify).toBe(false);
    expect(r.newDurum).toBe("kaybedildi");
    expect(r.stopSequence).toBe(true);
  });
});
```

**`tests/inbound.test.ts` — `makeDeps` güncelle:** `cls` mock'unu `ClassificationResult` yapısına geçirir; çağrı imza değişikliği yansır.

---

## 2. TG2 — Low-Confidence Override

### 2.1 `lib/services/inbound.ts:140`

Tek satırlık değişiklik:

```ts
// ÖNCE:
const auto = ACTION_MODES[plan.action] === "auto";

// SONRA:
const auto = ACTION_MODES[plan.action] === "auto" && cls.confidence >= CONF_THRESHOLD;
```

### 2.2 Test

`tests/inbound.test.ts`'e ekle:

```ts
it("düşük confidence (<0.5) → auto-mode bypass, taslak draft kalır", async () => {
  const deps = makeDeps({
    cls: "fiyat",
    confidence: 0.3,  // < CONF_THRESHOLD
    segment: "solo",
    aiBody: "Aylık taban 1.950 ₺...",
  });
  await run(deps);
  expect(deps.mail.createDraft).toHaveBeenCalled();
  expect(deps.mail.send).not.toHaveBeenCalled();  // auto-send YAPMAZ
  expect(deps.notify.hot).toHaveBeenCalled();      // "❓ Belirsiz cevap" bildirimi
});
```

---

## 3. TG3 — Notify Enrichment

### 3.1 `lib/services/notify.ts` — İmza zenginleştir

Mevcut `format` 5 satırla sınırlı. Yeni:

```ts
// lib/services/notify.ts
import type { NotifyPort } from "../domain/ports";
import type { Lead, InboundMessage } from "../domain/types";
import type { ClassificationResult } from "../domain/schemas";

export interface NotifyService {
  hot(
    label: string,
    lead: Lead,
    msg: InboundMessage,
    enrich?: NotifyEnrichment,  // YENİ — opsiyonel
  ): Promise<void>;
}

export interface NotifyEnrichment {
  cls?: ClassificationResult;
  premiumMatch?: boolean;  // detectPremiumSignal sonucu
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

### 3.2 `lib/services/inbound.ts` — Çağrıları güncelle

Mevcut `notify.hot` çağrıları (3 yerde):

**Web inbound new lead (satır 57):**
```ts
await deps.notify.hot(`🆕 Web inbound — ${cls.cls}`, lead, msg, { cls });
```

**Düşük confidence (satır 84):**
```ts
await deps.notify.hot("❓ Belirsiz cevap — elle bak", lead, msg, { cls });
```

**Plan.notify (satır 100):**
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

(`detectPremiumSignal` import et `lib/playbooks/index.ts`'ten.)

### 3.3 Test

`tests/inbound.test.ts`'e ekle:

```ts
it("notify.hot çağrısı zengin enrichment içerir (cls + premium)", async () => {
  const deps = makeDeps({ cls: "demo", segment: "mid" });
  await run(deps);
  expect(deps.notify.hot).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Object),
    expect.any(Object),
    expect.objectContaining({ cls: expect.objectContaining({ cls: "demo" }) }),
  );
});
```

---

## 4. TG4 — Lead Merge + alternateEmails

### 4.1 `lib/db/schema.ts` — Field ekle

```ts
// leads tablosu içine, kurumAdi'nin altına eklenebilir (sıralama önemli değil):
alternateEmails: text("alternate_emails").array().notNull().default([]),
```

Drizzle migration: `pnpm drizzle-kit generate`. Manuel kontrol et:

```sql
-- drizzle/0002_add_alternate_emails.sql
ALTER TABLE leads ADD COLUMN alternate_emails text[] NOT NULL DEFAULT '{}';
```

### 4.2 `lib/domain/types.ts` — Lead'e ekle

```ts
export interface Lead {
  // ... mevcut alanlar
  alternateEmails: string[];  // varsayılan []
}
```

Bu **bütün lead fixture'larını** etkiler. TS sweep:
- `tests/inbound.test.ts:6-28` (`makeLead`)
- `tests/playbooks.test.ts:6-28` (`lead`)
- `tests/outbound.test.ts` (varsa)

Hepsine `alternateEmails: []` ekle.

`lib/db/mappers.ts` (db row → Lead) güncelle:

```ts
export function toLead(row: typeof leads.$inferSelect): Lead {
  return {
    // ... mevcut
    alternateEmails: row.alternateEmails ?? [],
  };
}
```

### 4.3 `lib/util/email-parse.ts` — Free-mail domain listesi

Yeni export ekle (mevcut email-parse'a):

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

### 4.4 `lib/domain/ports.ts` — LeadRepo'ya method ekle

```ts
export interface LeadRepo {
  // ... mevcut method'lar
  byDomain(domain: string): Promise<Lead | null>;
  addAlternateEmail(id: string, email: string): Promise<void>;
}
```

### 4.5 `lib/db/repositories/lead.ts` — Implementasyon

`leadRepo` objesine ekle:

```ts
import { sql } from "drizzle-orm";

// ... mevcut method'ların yanına:

async byDomain(domain: string) {
  const d = domain.toLowerCase();
  // email ya domain ile bitsin ya da alternateEmails dizisindeki bir email bu domain'le bitsin.
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
  // Postgres array_append, ama önce duplicate check (idempotent):
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

### 4.6 `lib/services/inbound.ts` — Birleşme dalı

`inbound.ts:47-58` mevcut:

```ts
if (!lead) {
  lead = await deps.leads.upsertByEmail({ ... });
  await deps.events.log("inbound_new_lead", lead.id, { ... });
  await deps.notify.hot(`🆕 Web inbound — ${cls.cls}`, lead, msg);
}
```

Yeni:

```ts
if (!lead) {
  // 1) Domain match ile mevcut lead'le birleşmeyi dene (kurumsal domain).
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
  // 2) Yine yoksa yeni lead yarat.
  if (!lead) {
    lead = await deps.leads.upsertByEmail({
      email: msg.fromEmail,
      kurumAdi: `Web inbound — ${msg.fromEmail}`,
      segment: "unknown",
      durum: "yeni",
      kaynak: "inbound",
    });
    await deps.events.log("inbound_new_lead", lead.id, { from: msg.fromEmail, cls: cls.cls });
    await deps.notify.hot(`🆕 Web inbound — ${cls.cls}`, lead, msg, { cls });
  }
}
```

`import { emailDomain, isFreeMailDomain } from "../util/email-parse";` üst kısma.

### 4.7 Test

Yeni dosya `tests/inbound-merge.test.ts`:

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

const msg = {
  gmailMessageId: "m1", threadId: "t1",
  fromEmail: "info@x-poliklinigi.com.tr",
  subject: "Soru", body: "Hangi modülleri sunuyorsunuz?", receivedAt: new Date(),
};

function makeDeps(byEmailResult: any, byDomainResult: any) {
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
    const m = { ...msg, fromEmail: "klinik@gmail.com" };
    const deps = makeDeps(null, null);
    deps.mail.listRecentInbound = vi.fn().mockResolvedValue([m]);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.byDomain).not.toHaveBeenCalled();
    expect(deps.leads.upsertByEmail).toHaveBeenCalled();
  });

  it("kurumsal domain ama mevcut lead yok → yeni lead yaratılır", async () => {
    const deps = makeDeps(null, null);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.byDomain).toHaveBeenCalled();
    expect(deps.leads.upsertByEmail).toHaveBeenCalled();
  });
});
```

---

## 5. TG5 — Doc + Pricing Config

### 5.1 `docs/PRICING.md §10`

`docs/PRICING.md` satır 219 etrafındaki **"Satış akışı (mid/hastane)"** paragrafını [SPEC-DELTA §8.2](SPEC-DELTA.md#82-yeni-adr-0005-hizal%C4%B1) içeriğiyle değiştir. Ek: dosyanın üst kısmındaki sürüm/durum bloğuna 2026-05-26 notu ekle:

```
> v3.3 (2026-05-26) — §10 satış akışı 2-adımlı (demo → ayrı teklif görüşmesi) olarak güncellendi
> (ADR-0005). Fiyat seviyeleri değişmedi.
```

### 5.2 `lib/config/pricing.ts` — Mid + Hospital bantları

Mevcut dosyanın **sonuna** ekle (mevcut `SOLO_PRICES`, `getSoloPrice`, `expansionDiscount`, `formatTRY` korunur):

```ts
// --- Mid bandı (3-5 vet) - Referans tablosu ---
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

// --- Hospital bandı (6+ vet) - Referans tablosu ---
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

`SoloPriceResult` ismi şu an değişmez; ileride `PriceResult`'a rename olabilir.

### 5.3 Test

`tests/config.test.ts`'e ekle:

```ts
import { getMidPrice, getHospitalPrice } from "@/lib/config/pricing";

describe("pricing — mid/hospital reference tables", () => {
  it("mid 4 vet + muhasebe ≈ 11.370 (PRICING.md §5 senaryo)", () => {
    // 3200 + 4*220 + 3300 (1 modül, %0 indirim) = 7380; senaryoda 3 modül -%10 var
    const r = getMidPrice({ modules: ["muhasebe", "ik", "analitik"], vetCount: 4 });
    // 3200 + 880 + (3300+2800+2000)*0.9 = 4080 + 7290 = 11.370
    expect(r.total).toBe(11370);
  });

  it("hospital 6 vet full + kafe ≈ 22.125", () => {
    // 5400 + 6*195 + (7000+5800+4100+1400)*0.85 = 6570 + 15555 = 22.125
    const r = getHospitalPrice({ modules: ["muhasebe", "ik", "analitik", "kafe"], vetCount: 6 });
    expect(r.total).toBe(22125);
  });
});
```

---

## 6. Sıralama ve PR Stratejisi

Önerilen PR akışı:

| PR | İçerik | Bağımlılık |
|---|---|---|
| **PR1** — `feat/playbook-v2-tg1` | TG1 (segment.ts, playbooks, AI prompt, satis_spami) | Yok (Lead.alternateEmails henüz yok — fixture'lara `[]` ekle, ama field henüz tipte yok → TG4'le çakışma riski; alternatif: tüm tip değişiklikleri TG4 öncesi yapılsın). |
| **PR2** — `feat/playbook-v2-tg2-tg3` | TG2 (confidence) + TG3 (notify) | PR1 (cls full obje akışı). |
| **PR3** — `feat/playbook-v2-tg4` | TG4 (lead merge + migration) | Yok (izole) — ama PR1 ile çakışma için TG4'ün **önce** yapılması daha güvenli (tip sweep tek seferde). |
| **PR4** — `feat/playbook-v2-tg5` | TG5 (doc + pricing config) | Yok. |

**Daha basit alternatif:** Tek PR'da tüm 5 task (PROMPT.md kullanımı bunu yapar). Review riski: 200-300 LOC, hala yönetilebilir.

**Çakışma uyarısı:** `Lead` interface'i hem TG1 testlerinde (yeni fixture'lar) hem de TG4'te (`alternateEmails`) değişiyor. TG4 önce yapılırsa, TG1 fixture'larına `alternateEmails: []` zaten eklenmiş olur. **Sıra: TG4 → TG1 → TG2/3 → TG5** kompakt.

---

## 7. Doğrulama Kontrol Listesi

Tüm değişiklikler sonrası:

```bash
# 1. Kod kalitesi
pnpm lint
pnpm typecheck

# 2. Test
pnpm test

# 3. Migration doğru sıra
ls drizzle/  # 0001_..., 0002_... bekleniyor
pnpm drizzle-kit migrate  # shadow DB'de denenir

# 4. Doc-code drift kontrolü
rg "demoda.*(teklif|net)" docs/ lib/  # 0 hit beklenir
rg "fromEmail.*domain.*segment" lib/  # 0 hit (asla domain → segment)

# 5. Test coverage smoke
pnpm test -- --coverage  # ilgili dosyalarda %>80
```

End-to-end (opsiyonel):
- Staging DB'de TG4 migration → manuel insert + `byDomain` query.
- Gmail'e test mail (kurumsal domain) gönder → birleşme oluyor mu, `events` tablosunda `inbound_lead_merged` var mı.
- Test mail (free-mail) → yeni lead yaratıldı mı.
- Test mail (premium keyword içeren fiyat sorusu) → Telegram `Premium sinyal: VAR` içeriyor mu, taslak mid pivot mu.
