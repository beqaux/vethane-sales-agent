# TASKS — Playbook v2

> **5 thematic task (TG1-TG5).** Her biri tek oturumda biter, kendi PR'ı açılabilir.
> **Önerilen sıra:** TG4 → TG1 → TG2 → TG3 → TG5 (TG4 önce: tip sweep çakışmasını önler).
> **Tüm refs:** [SPEC-DELTA](SPEC-DELTA.md), [IMPLEMENTATION](IMPLEMENTATION.md), [ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md).

---

## Summary

| Metric | Value |
|---|---|
| Toplam Task | 5 |
| Toplam Efor | ~14-18h |
| Foundation (DB migration) | TG4 |
| Kullanıcı görünür davranış | TG1, TG2, TG3 |
| Doc + config | TG5 |

---

## TG4: Lead Merge + alternateEmails (önce yap)

**Aynı kurumun farklı e-postalarını tek lead'de topla; `alternateEmails text[]` migration.**

**Files (yarat/değiştir):**
- `lib/db/schema.ts` — `leads.alternateEmails text[]` field ekle
- `drizzle/0002_add_alternate_emails.sql` — migration (drizzle-kit generate ile üretilir)
- `lib/domain/types.ts` — `Lead.alternateEmails: string[]` ekle
- `lib/domain/ports.ts` — `LeadRepo.byDomain` + `addAlternateEmail` method'ları
- `lib/db/repositories/lead.ts` — `byDomain` + `addAlternateEmail` impl
- `lib/db/mappers.ts` — `toLead` mapper `alternateEmails` taşır
- `lib/util/email-parse.ts` — `FREE_MAIL_DOMAINS` Set + `emailDomain` + `isFreeMailDomain` helper
- `lib/services/inbound.ts:47-58` — domain match branch
- `tests/inbound-merge.test.ts` — yeni dosya (3 senaryo: kurumsal match, free-mail skip, no match)
- `tests/inbound.test.ts`, `tests/playbooks.test.ts` — fixture'lara `alternateEmails: []` ekle (TS sweep)

**Code Pattern (özet):**

```ts
// services/inbound.ts — birleşme dalı
if (!lead) {
  const domain = emailDomain(msg.fromEmail);
  if (domain && !isFreeMailDomain(domain)) {
    const existing = await deps.leads.byDomain(domain);
    if (existing) {
      await deps.leads.addAlternateEmail(existing.id, msg.fromEmail);
      lead = { ...existing, alternateEmails: [...existing.alternateEmails, msg.fromEmail.toLowerCase()] };
      await deps.events.log("inbound_lead_merged", lead.id, { from: msg.fromEmail, matchedDomain: domain });
    }
  }
  if (!lead) {
    lead = await deps.leads.upsertByEmail({ ... });
    // ... mevcut yeni-lead akışı
  }
}
```

**AC:**
- [ ] Drizzle migration üretilmiş, `alternate_emails text[] NOT NULL DEFAULT '{}'` kolonu var.
- [ ] `LeadRepo.byDomain("x-poliklinik.com.tr")` mevcut lead'i (email VEYA alternateEmails'inde aynı domain varsa) döner.
- [ ] `addAlternateEmail` idempotent (aynı email iki kez eklenirse array büyümez).
- [ ] Kurumsal domain match → mevcut lead'e merge; `upsertByEmail` çağrılmaz.
- [ ] Free-mail domain (gmail/hotmail/yahoo/outlook/icloud + .tr versiyonları) → `byDomain` çağrılmaz, yeni lead yaratılır.
- [ ] `events` tablosuna `inbound_lead_merged` log'u yazılır (matchedDomain + fromEmail).
- [ ] Tüm Lead fixture'lara `alternateEmails: []` eklenmiş, `pnpm typecheck` geçer.
- [ ] `tests/inbound-merge.test.ts` 3 senaryo geçer.

**Dependencies:** Yok (izole) · **Effort:** 4-5h · **Refs:** [SPEC-DELTA §6](SPEC-DELTA.md#6-lead-merge--alternateemails), [IMPLEMENTATION §4](IMPLEMENTATION.md#4-tg4--lead-merge--alternateemails)

---

## TG1: Playbook Routing v2 (premium detection + satis_spami + segment kuralı)

**Web inbound + fiyat sorusu için doğru playbook'a route; `satis_spami` yeni classification; segment türetme tür-öncelikli.**

**Files:**
- `lib/util/segment.ts` — `deriveSegment` tür-öncelikli versiyon (full replace)
- `lib/playbooks/index.ts` — `detectPremiumSignal` helper + `buildReplyFor` unknown+fiyat dalı + `commonReply` satis_spami dalı + `Playbook.buildReply` imza `ClassificationResult` alır
- `lib/config/playbooks.ts` — `solo.fiyatReply.guidance`, `mid.reply.guidance`, `hospital.reply.guidance` ADR-0005 hizalı güncellenir
- `lib/adapters/ai.ts` — `CLASSIFY_SYSTEM` `satis_spami` sınıfı ekle; classify prompt'una `fromEmail` ekle
- `lib/domain/enums.ts` — `CLASSIFICATIONS` array'ine `"satis_spami"` ekle
- `drizzle/0003_add_satis_spami_classification.sql` — Postgres enum'a değer ekle
- `lib/services/inbound.ts:72` — `buildReply(lead, msg, cls)` çağrısı (cls.cls → cls)
- `tests/segment.test.ts` — yeni tür-öncelikli senaryolar
- `tests/playbooks.test.ts` — unknown+fiyat premium detection senaryoları + satis_spami senaryosu

**Code Pattern (özet):**

```ts
// playbooks/index.ts — yeni helper
const PREMIUM_KEYWORDS = /(hastane|poliklinik|şube|merkez|zincir|grup)/i;

export function detectPremiumSignal(ctx: { lead: Lead; msg: InboundMessage; cls: ClassificationResult }): boolean {
  const text = `${ctx.lead.kurumAdi} ${ctx.msg.subject} ${ctx.msg.body}`;
  if (PREMIUM_KEYWORDS.test(text)) return true;
  if (ctx.cls.segmentGuess === "mid" || ctx.cls.segmentGuess === "hospital") return true;
  return false;
}

// buildReplyFor — unknown + fiyat dalı
if (segment === "unknown" && cls.cls === "fiyat") {
  const isPremium = detectPremiumSignal({ lead, msg, cls });
  if (isPremium) return { action: "mid_reply", ..., notify: true };
  return { action: "solo_fiyat", ..., includePrice: true, priceText: soloPriceText(lead), notify: true };
}
```

**AC:**
- [ ] `deriveSegment(2, "hastane") === "hospital"` (eski: solo; yeni: hospital).
- [ ] `deriveSegment(5, "poliklinik") === "mid"`, `deriveSegment(6, "poliklinik") === "hospital"`.
- [ ] `deriveSegment(3, "muayenehane") === "mid"`, `deriveSegment(null, "muayenehane") === "solo"`.
- [ ] `detectPremiumSignal({ lead: { kurumAdi: "X Hayvan Hastanesi" }, msg, cls: {...} }) === true`.
- [ ] Unknown segment + fiyat + premium → mid playbook (action: `mid_reply`, priceText undefined, notify true).
- [ ] Unknown segment + fiyat + no premium → solo playbook (action: `solo_fiyat`, includePrice true, priceText ₺ içerir, notify true).
- [ ] `satis_spami` classification → sendDraft false, notify false, newDurum kaybedildi.
- [ ] `CLASSIFY_SYSTEM` prompt'unda `satis_spami` tanımı geçer.
- [ ] Classify çağrısında prompt `Gönderen: ${fromEmail}` ile başlar.
- [ ] `lib/config/playbooks.ts` içinde `rg "demoda.*(teklif|fiyat|net)"` 0 hit (mid.reply, hospital.reply, solo.fiyatReply doğru güncellendi).
- [ ] `pnpm test tests/playbooks.test.ts tests/segment.test.ts tests/inbound.test.ts` geçer.

**Dependencies:** TG4 (Lead.alternateEmails fixture eklenmiş olmalı) · **Effort:** 5-6h · **Refs:** [SPEC-DELTA §1, §2, §4](SPEC-DELTA.md#1-davran%C4%B1%C5%9F-matrisi-7-senaryo), [IMPLEMENTATION §1](IMPLEMENTATION.md#1-tg1--playbook-routing-v2)

---

## TG2: Low-Confidence Auto-Mode Override

**`cls.confidence < 0.5` ise auto-mode bypass; taslak draft kalır, send YAPMAZ.**

**Files:**
- `lib/services/inbound.ts:140` — `auto` koşuluna `&& cls.confidence >= CONF_THRESHOLD` ekle
- `tests/inbound.test.ts` — yeni senaryo

**Code Pattern:**

```ts
// inbound.ts:140
const auto = ACTION_MODES[plan.action] === "auto" && cls.confidence >= CONF_THRESHOLD;
if (auto) await deps.mail.send(created.id);
```

**AC:**
- [ ] `cls.confidence = 0.3` + `plan.action = "solo_fiyat"` (auto modunda) → `mail.send` çağrılmaz.
- [ ] `cls.confidence = 0.6` + `plan.action = "solo_fiyat"` → `mail.send` çağrılır (mevcut davranış).
- [ ] `notify.hot("❓ Belirsiz cevap — elle bak", ...)` zaten gidiyor (`inbound.ts:84`); değişiklik yok.
- [ ] Messages tablosuna `status: "draft"` yazılır (auto false → draft).

**Dependencies:** TG1 (cls full obje akışı stabil) · **Effort:** 1h · **Refs:** [SPEC-DELTA §5](SPEC-DELTA.md#5-low-confidence-override), [IMPLEMENTATION §2](IMPLEMENTATION.md#2-tg2--low-confidence-override)

---

## TG3: Notify Enrichment

**Telegram bildiriminde sender, AI confidence, segmentGuess, premium keyword match göster.**

**Files:**
- `lib/services/notify.ts` — `NotifyEnrichment` interface; `hot` 4. parametre opsiyonel
- `lib/services/inbound.ts` — 3 `notify.hot` çağrısı `enrich` parametresi alır
- `tests/inbound.test.ts` — enrichment doğrulama testi

**Code Pattern:**

```ts
// notify.ts — yeni interface
export interface NotifyEnrichment {
  cls?: ClassificationResult;
  premiumMatch?: boolean;
}

// hot çağrısı (inbound.ts:100)
const enrich: NotifyEnrichment = {
  cls,
  premiumMatch: segment === "unknown" ? detectPremiumSignal({ lead, msg, cls }) : undefined,
};
await deps.notify.hot(label, lead, msg, enrich);
```

**AC:**
- [ ] `notify.hot` 4. parametre `enrich?: NotifyEnrichment` opsiyonel.
- [ ] Telegram mesajında `AI: cls=demo, confidence=0.92, segmentGuess=mid` satırı var.
- [ ] `Gönderen: info@x-poliklinigi.com.tr` satırı var (msg.fromEmail).
- [ ] Premium signal `unknown` segment'te `Premium sinyal: VAR/yok` satırı var.
- [ ] Plan.notify dışı çağrıların (`inbound.ts:57, :84`) hala düzgün çalışıyor (geri uyumlu — enrich opsiyonel).
- [ ] `pnpm test tests/inbound.test.ts` geçer.

**Dependencies:** TG1 (detectPremiumSignal export) · **Effort:** 1.5h · **Refs:** [SPEC-DELTA §1 S2](SPEC-DELTA.md#1-davran%C4%B1%C5%9F-matrisi-7-senaryo), [IMPLEMENTATION §3](IMPLEMENTATION.md#3-tg3--notify-enrichment)

---

## TG5: Doc + Pricing Config (izole, kod davranışı değişmez)

**`docs/PRICING.md §10` 2-adımlı satışla güncellenir; `lib/config/pricing.ts`'e mid + hospital referans tabloları eklenir.**

**Files:**
- `docs/PRICING.md` — §10 paragrafı (SPEC-DELTA §8.2 metniyle değiştir); başlık bloğuna v3.3 (2026-05-26) notu
- `lib/config/pricing.ts` — `MID_PRICES`, `HOSPITAL_PRICES`, `getMidPrice`, `getHospitalPrice`, `PriceTableSchema` validations
- `tests/config.test.ts` — mid/hospital senaryo testleri (PRICING.md §5 ile aynı sonuçlar)

**Code Pattern:**

```ts
// config/pricing.ts — yeni eklemeler
export const MID_PRICES = { taban: 3200, doktorPerVet: 220, muhasebe: 3300, ik: 2800, analitik: 2000, kafe: 900 } as const;
export const HOSPITAL_PRICES = { taban: 5400, doktorPerVet: 195, muhasebe: 7000, ik: 5800, analitik: 4100, kafe: 1400 } as const;

export function getMidPrice(opts: { modules: PricingModule[]; vetCount: number }): SoloPriceResult { ... }
export function getHospitalPrice(opts: { modules: PricingModule[]; vetCount: number }): SoloPriceResult { ... }
```

**AC:**
- [ ] `docs/PRICING.md §10` "Satış akışı (mid/hastane)" paragrafı 2-adımlı (demo → ayrı teklif görüşmesi) tanımla yazılı.
- [ ] PRICING.md başlığında `v3.3 (2026-05-26)` notu var, ADR-0005 referansı geçer.
- [ ] `rg "demoda harcama|demoda net teklif" docs/` 0 hit.
- [ ] `getMidPrice({ modules: ["muhasebe", "ik", "analitik"], vetCount: 4 }).total === 11370` (PRICING.md §5 senaryosu).
- [ ] `getHospitalPrice({ modules: ["muhasebe", "ik", "analitik", "kafe"], vetCount: 6 }).total === 22125` (PRICING.md §5 senaryosu).
- [ ] `getSoloPrice` mevcut davranışı bozulmadı (`tests/config.test.ts` mevcut testleri geçer).
- [ ] `pnpm test tests/config.test.ts` geçer.

**Dependencies:** Yok (izole) · **Effort:** 2-3h · **Refs:** [SPEC-DELTA §7, §8](SPEC-DELTA.md#7-pricing-config-geni%C5%9Flemesi-referans-tablosu), [IMPLEMENTATION §5](IMPLEMENTATION.md#5-tg5--doc--pricing-config), [ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md)

---

## Bağımlılık Grafiği

```
TG4 (lead merge + DB migration)
  └── TG1 (playbook routing) ← TG4'ün Lead tipi sweep'ini kullanır
       ├── TG2 (low-confidence) ← TG1'in cls full obje akışını kullanır
       └── TG3 (notify enrichment) ← TG1'in detectPremiumSignal export'unu kullanır

TG5 (doc + pricing config) — bağımsız, herhangi bir zaman
```

Tek-PR alternatifi: TG4 → TG1 → TG2 + TG3 + TG5 birlikte, ardından e2e doğrulama.

---

## Toplu Doğrulama Komutu

Her task tamamlandıktan sonra:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Tüm 5 task tamamlandıktan sonra (final smoke):

```bash
pnpm lint && pnpm typecheck && pnpm test && \
  rg "demoda.*(teklif|net)" docs/ lib/ && \
  rg "fromEmail.*domain.*segment" lib/  # son ikisinin 0 hit olması bekleniyor
```
