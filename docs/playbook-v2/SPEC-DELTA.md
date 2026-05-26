# SPEC-DELTA — Playbook v2 (Inbound Routing & Lead Merge)

> **Kapsam:** `docs/SPECIFICATION.md`'a delta. Sadece **bu iterasyonda değişen** spec parçaları. Mevcut SPECIFICATION dokunulmaz; bu doc onunla birlikte okunur.
> **Tarih:** 2026-05-26.
> **Karar kaynakları:** `CONTEXT.md` karar #2 + §3, [ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md), handoff (2026-05-26 grilling).

---

## 1. Davranış Matrisi (7 Senaryo)

Mevcut SPEC §3.4.2 ("Inbound döngüsü → playbook'a yönlendir") satırını bu matris **somutlaştırır**:

| # | Senaryo | Tetikleyici | Beklenen Davranış | Code Touch |
|---|---|---|---|---|
| S1 | Web inbound + fiyat sorusu | `lead.segment === "unknown"` + `cls.cls === "fiyat"` | **Premium sinyal varsa** (regex `/(hastane\|poliklinik\|şube\|merkez\|zincir)/i` `lead.kurumAdi + msg.subject + msg.body`'de **veya** `cls.segmentGuess ∈ {mid, hospital}`): mid playbook → "Klinik büyüklüğüne göre değişiyor; kaç veteriner ile çalıştığınızı öğrenebilir miyim?" + auto + Telegram. **Aksi:** solo playbook → 1 vet ve 2 vet için fiyat örneği (`SOLO_PRICES`'tan) + "kaç vet?" sor + auto + Telegram. | `lib/playbooks/index.ts`, `lib/config/playbooks.ts` |
| S2 | Web inbound + demo isteği | `lead.segment === "unknown"` + `cls.cls === "demo"` | Auto teyit cevabı (mevcut `demoReply` playbook + `solo` davranışı). **+ Zengin Telegram:** sender, mesaj özeti (≤280 char), `cls.confidence`, `cls.segmentGuess`, premium keyword match (varsa). | `lib/services/notify.ts`, `lib/services/inbound.ts` |
| S3 | Outbound + ilgili + segment unknown | `lead.kaynak !== "inbound"` + `cls.cls === "ilgili"` + `lead.segment === "unknown"` | **Kod değişmez.** Operasyonel kural: sourcing eksik — `unknown` segment lead'i sequence'e girmesin. `tests/repositories/lead.test.ts` `dueForSend` filtresi zaten `segment IS NOT NULL` değil; ama `unknown` lead aday onayında reddedilsin (manuel hijyen). | (doc-only) |
| S4 | Düşük confidence (<0.5) | `cls.confidence < CONF_THRESHOLD` | Auto-mode bypass. Plan üretilir, taslak oluşturulur ama `auto` değil (manuel kuyrukta kalır). `notify.hot` zaten gidiyor ("❓ Belirsiz cevap — elle bak"); davranış: `ACTION_MODES[plan.action] === "auto"` kontrolü `&& cls.confidence >= CONF_THRESHOLD` ile genişletilir. | `lib/services/inbound.ts:140` |
| S5 | Çıkış + unknown email | `cls.cls === "cikis"` + `lead === null` (web inbound) | **Kod doğru, değişiklik yok.** `lead.email ?? msg.fromEmail` fallback'i `inbound.ts:87` ve `:104`'te zaten var. | (no-op) |
| S6 | Aynı kurum farklı email | `byEmail(msg.fromEmail) === null` ama domain eşleşen mevcut lead var | **Domain-match ile birleştir.** `msg.fromEmail` parçalanır → domain çıkarılır → `leads`'te bu domain'i email veya alternateEmails'ında barındıran lead aranır. Bulunursa mevcut lead'e `alternateEmails`'e ekle (text[]); yeni lead yaratma branch'i atlanır. Free-mail domain'leri (gmail/hotmail/yahoo/outlook/icloud) **birleşme tetiklemez**. | `lib/db/schema.ts`, `lib/db/repositories/lead.ts`, `lib/services/inbound.ts`, migration |
| S7 | Pazarlama/satış spam'i | İçerik başka SaaS'tan cold mail (Vethane'le ilgili değil; kendi ürünlerini satıyor) | Yeni classification `satis_spami`. Davranış: `sendDraft=false`, `notify=false`, `stopSequence=true` (eğer lead sequence'taysa — pratikte web inbound olduğu için yok), `suppress=false`, `newDurum="kaybedildi"`. Sadece event log. | `lib/domain/enums.ts`, `lib/domain/schemas.ts`, `lib/adapters/ai.ts`, `lib/playbooks/index.ts` |

---

## 2. Segment Türetme — Yeni Kural (Tür-Öncelikli)

### Eski (mevcut `lib/util/segment.ts:7-20`)

```ts
// VET SAYISI ÖNCELİKLİ — yanlış davranış
if (vetSayisi != null && vetSayisi > 0) {
  if (vetSayisi >= 6) return "hospital";
  if (vetSayisi >= 3) return "mid";
  return "solo";
}
// Sadece vetSayisi yoksa tür'e bak
if (tur === "hastane") return "hospital";
// ...
```

Bug: `vetSayisi=2 + tur="hastane"` → `solo` (yanlış, hastane her zaman hospital).

### Yeni (CONTEXT.md §3 hizalı)

```ts
// TÜR ÖNCELİKLİ — her zaman ünvana göre karar al, vet sayısı refine eder
if (tur === "hastane") return "hospital";  // ünvanı varsa her zaman hospital
if (tur === "poliklinik") {
  return (vetSayisi != null && vetSayisi >= 6) ? "hospital" : "mid";
}
if (tur === "muayenehane") {
  if (vetSayisi == null) return "solo";  // muayenehane default solo (yasayla ≤3 vet)
  if (vetSayisi >= 3) return "mid";       // muayenehane + 3 vet → mid (yasal sınır)
  return "solo";
}
// Tür belirsiz → vet sayısına düş
if (vetSayisi != null && vetSayisi > 0) {
  if (vetSayisi >= 6) return "hospital";
  if (vetSayisi >= 3) return "mid";
  return "solo";
}
return "unknown";
```

### Etki

| Input | Eski | Yeni | Doğru? |
|---|---|---|---|
| `vetSayisi=2, tur=hastane` | `solo` | `hospital` | ✅ |
| `vetSayisi=5, tur=poliklinik` | `mid` | `mid` | ✅ (aynı) |
| `vetSayisi=6, tur=poliklinik` | `hospital` | `hospital` | ✅ (aynı) |
| `vetSayisi=null, tur=hastane` | `hospital` | `hospital` | ✅ (aynı) |
| `vetSayisi=null, tur=null` | `unknown` | `unknown` | ✅ (aynı) |
| `vetSayisi=4, tur=null` | `mid` | `mid` | ✅ (aynı) |

Tek davranış değişikliği: **`tur=hastane` + `vetSayisi<6`** durumu artık doğru segment veriyor. Pratikte nadir (hastane ruhsatı için yasal minimum vet sayısı yok ama tipik hastane ≥6) ama doğru olması önemli (CONTEXT.md §3 kuralı).

---

## 3. Detection Katmanları

CONTEXT.md §3'e eklenen "Detection katmanları" alt-bölümü kod kararına şöyle yansır:

### 3.1 Sourcing anı (lead DB'ye yazılırken)
`scripts/import-candidates.ts` ve Places API'den gelen veri ile `deriveSegment(vetSayisi, tur)` uygulanır. Yeni tür-öncelikli kural buraya hizalanır.

### 3.2 Web inbound (lead.segment === "unknown")
Sıra:
1. **Keyword:** `lead.kurumAdi + msg.subject + msg.body` üzerinde `detectPremiumSignal()` regex match.
2. **AI segmentGuess:** `cls.segmentGuess` (Haiku zaten döndürüyor).
3. **Sayı extract:** body'de "4 vet", "8 hekim" gibi regex (faz-2, bu iterasyonda yok).

Sırası ÖNEMLİ: Keyword **explicit > AI guess** çünkü keyword deterministik (false-positive düşük); AI guess valeur-doğrulu ama hallucination olabilir.

### 3.3 `fromEmail` domain'i (KARARA GİRMEZ)

```ts
// YANLIŞ pattern (yapılmıyor, yapılmasın):
const isCorporate = !FREE_MAIL_DOMAINS.has(domain(msg.fromEmail));
if (isCorporate) segment = "mid"; // ← HATA
```

Gerekçe (handoff'tan): TR'de **küçük-orta klinikler genelde Gmail/Hotmail** kullanıyor. Kurumsal mail (`@klinikadi.com`) nadir. Domain segment sinyali olarak **güvenilir değil**, false-positive yüksek. Sadece **event log**'a yazılır (`fromEmail` gözlemlenebilirlik için).

### 3.4 İlk cevap sonrası
Lead'in `segment` bilgisi yoksa, gelen mesajda "biz 4 vet'iz" gibi açıklama olursa, `vetSayisi` extract edilir → `deriveSegment` ile hard-set. Bu iterasyonda **otomatize edilmedi**; manuel.

---

## 4. Yeni Classification: `satis_spami`

### 4.1 Tanım

Klinik bağlamı dışında AI ajan'a gelen pazarlama/satış mailleri. Tipik örnekler:
- Başka SaaS'tan cold outbound ("CRM çözümünüz için demo isteyin").
- Linked-in invite spam, ajans pitchleri.
- "Backlink değişimi" SEO spam'i.

**`ilgisiz` ile fark:** `ilgisiz` = lead Vethane'i reddediyor (kibar ret); `satis_spami` = göndericinin Vethane ile alakası yok, lead bile değil.

### 4.2 Schema

```ts
// lib/domain/enums.ts
export const CLASSIFICATIONS = [
  "fiyat", "demo", "ilgili", "ilgisiz", "oto_yanit", "cikis",
  "satis_spami",  // YENİ
] as const;
```

### 4.3 Davranış (common reply)

```ts
// lib/playbooks/index.ts - commonReply içine
if (cls === "satis_spami") {
  return {
    action: "cikis_reply",  // mevcut ActionType reuse — yeni action açmaya gerek yok
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

`notify=false` çünkü kurucu bu spam'leri görmek istemez; event log yeter.

### 4.4 AI Prompt Update

`lib/adapters/ai.ts:21-29` `CLASSIFY_SYSTEM` güncellemesi:

```
- satis_spami: Vethane veteriner bağlamı dışında başka bir ürün/servis pazarlayan cold mail
  (ör. başka SaaS demo daveti, ajans pitch, backlink takası).
```

---

## 5. Low-Confidence Override

### 5.1 Mevcut Davranış (`lib/services/inbound.ts:140`)

```ts
const auto = ACTION_MODES[plan.action] === "auto";
if (auto) await deps.mail.send(created.id);
```

Sorun: AI `confidence=0.3` ile yanlış sınıflarsa (ör. `solo` yerine `mid`'e fiyat veriyor), `solo_fiyat` action `auto`. Mail gidiyor → potansiyel hata.

### 5.2 Yeni Davranış

```ts
const auto = ACTION_MODES[plan.action] === "auto" && cls.confidence >= CONF_THRESHOLD;
if (auto) await deps.mail.send(created.id);
```

`CONF_THRESHOLD = 0.5` zaten var (`inbound.ts:19`). Düşük confidence'da:
- Plan üretilir.
- Taslak Gmail'de oluşur.
- `auto` send YAPMAZ — taslak kuyrukta kalır.
- Mevcut `notify.hot("❓ Belirsiz cevap — elle bak", ...)` zaten gidiyor (`inbound.ts:84`).

Sonuç: AI emin değilse, hız yerine doğruluk; kurucu bakar.

---

## 6. Lead Merge — `alternateEmails`

### 6.1 Şema Değişikliği

```ts
// lib/db/schema.ts - leads tablosuna:
alternateEmails: text("alternate_emails").array().default([]).notNull(),
```

Drizzle migration: `0001_add_alternate_emails.sql`. Tip:
- `text[]` Postgres native array.
- Default `'{}'` (boş).
- Index gerekmez (lookup bu iterasyonda manuel; ileride GIN gerekirse eklenir).

### 6.2 Birleşme Mantığı

`lib/services/inbound.ts:47-58` mevcut:

```ts
let lead = byThread || byEmail;
if (!lead) {
  // Web inbound → yeni lead yarat
  lead = await deps.leads.upsertByEmail({ ... });
}
```

Yeni:

```ts
let lead = byThread || byEmail;
if (!lead) {
  const fromDomain = msg.fromEmail.split("@")[1]?.toLowerCase();
  if (fromDomain && !FREE_MAIL_DOMAINS.has(fromDomain)) {
    // Kurumsal domain — mevcut lead'le birleşmeyi dene
    const existing = await deps.leads.byDomain(fromDomain);
    if (existing) {
      await deps.leads.addAlternateEmail(existing.id, msg.fromEmail);
      lead = existing;
    }
  }
  if (!lead) {
    // Yine yoksa yeni lead yarat (mevcut akış)
    lead = await deps.leads.upsertByEmail({ ... });
  }
}
```

`FREE_MAIL_DOMAINS`: en az `gmail.com, hotmail.com, outlook.com, yahoo.com, yahoo.com.tr, icloud.com, hotmail.com.tr, mynet.com, windowslive.com`. Detaylı liste `lib/util/email-parse.ts`'e taşınır (zaten oraya yakın).

### 6.3 Yeni Repo Method'ları

```ts
// LeadRepo arayüzüne:
interface LeadRepo {
  // ... mevcut method'lar
  byDomain(domain: string): Promise<Lead | null>;
  addAlternateEmail(id: string, email: string): Promise<void>;
}
```

`byDomain` lookup:
```sql
SELECT * FROM leads
WHERE email LIKE '%@' || $1
   OR $1 = ANY(SELECT split_part(unnest(alternate_emails), '@', 2))
LIMIT 1
```

(Postgres `split_part` + `unnest` ile array içinde domain match; performans daha sonra GIN ile çözülür.)

### 6.4 `Lead` Tipinin Genişlemesi

```ts
// lib/domain/types.ts - Lead interface'ine:
alternateEmails: string[];  // varsayılan []
```

Mevcut bütün lead instantiate'lerinde (test fixtures dahil) `alternateEmails: []` eklemek gerekecek. TypeScript bunu yakalayacak; sweep.

### 6.5 Edge Cases

- `msg.fromEmail` zaten lead'in `email`'i ise: `byEmail` zaten match etti, bu kod yoluna girilmez.
- `msg.fromEmail` zaten `alternateEmails`'da: `byDomain` lookup bulunca, `addAlternateEmail` no-op (already exists, idempotent).
- Aynı domain'de iki farklı lead varsa (örn. bir kurumsal grup): ilk match alınır. Pratikte nadir, riski kabul ediyoruz; manuel hijyen.

---

## 7. Pricing Config Genişlemesi (Referans Tablosu)

### 7.1 Mevcut (`lib/config/pricing.ts`)

Sadece solo bandı var:

```ts
export const SOLO_PRICES = {
  taban: 1950, doktorPerVet: 260, muhasebe: 1950, ik: 1550, analitik: 1050, kafe: 650
};
```

### 7.2 Yeni — Mid + Hospital Bantları

PRICING.md §2 fiyat matrisinden hizalı:

```ts
export const MID_PRICES = {
  taban: 3200, doktorPerVet: 220, muhasebe: 3300, ik: 2800, analitik: 2000, kafe: 900
} as const;

export const HOSPITAL_PRICES = {
  taban: 5400, doktorPerVet: 195, muhasebe: 7000, ik: 5800, analitik: 4100, kafe: 1400
} as const;
```

**KRİTİK:** Bu tablolar AI'a verilmiyor (guardrail `noPriceForBigSegment` mid/hospital outbound'da fiyatı engelliyor — değişmedi). Sadece **kurucu referans** + **gelecek kullanım** (Faz-2 teklif görüşmesi otomatize edilirse). Mevcut `getSoloPrice` tek tüketici.

### 7.3 Helper'lar (opsiyonel ama tutarlı)

```ts
export function getMidPrice(opts: { modules: Module[]; vetCount: number }): PriceResult { ... }
export function getHospitalPrice(opts: { modules: Module[]; vetCount: number }): PriceResult { ... }
```

`SoloModule` zaten `"muhasebe" | "ik" | "analitik" | "kafe"`; bu reuse edilir (`Module = SoloModule`).

`expansionDiscount` üç segment için aynı (%5/%10/%15) → mevcut function reuse.

---

## 8. Doc Update — `docs/PRICING.md §10`

### 8.1 Eski

```
**Satış akışı (mid/hastane):** demo → "bugün muhasebeci + bordro + raporlamaya ne harcıyorsunuz?"
(≈ §4.1 arka-ofis maliyeti, ₺25-90k) → Vethane tek sistemde + fraksiyonuna → büyüklük bandına göre teklif.
```

### 8.2 Yeni (ADR-0005 hizalı)

```
**Satış akışı (mid/hastane), 2-adımlı:**

**Adım 1 — Demo (sistem gösterimi):** Klinik isteyince, AI ajan demo zamanı önerir ve kurucuya
Telegram bildirir. Demo = fake-data ürün-tour'u (modüller, ekranlar, akış). **Demoda harcama sorusu
ve teklif YOKTUR.** Demo bitiminde kurucu, klinikten "teklif görüşmesi" için ayrı bir takvim
slot'u talep eder.

**Adım 2 — Teklif görüşmesi (kurucu manuel):** "Bugün muhasebeci + bordro + vardiya + raporlamaya
ne harcıyorsunuz?" (≈ §4.1 arka-ofis maliyeti, ₺25-90k) → Vethane tek sistemde + fraksiyonuna
→ klinik büyüklük bandına göre teklif.

Bu ayrım [ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md) ile kararlaştırıldı.
Demo sürtünmesini düşürür (daha çok demo bookings); teklif görüşmesi nitelikli müşteriyle yapılır.
```

---

## 9. Mevcut SPEC Bölümleriyle İlişki

| SPEC bölümü (mevcut) | Bu delta ile etkilenir mi? | Nasıl? |
|---|---|---|
| §2 Mimari | Hayır | Değişmeden korunur. |
| §3.1.2 Segment türetme | Evet | Yeni tür-öncelikli kural (bu doc §2). |
| §3.3 Outbound | Hayır | Değişmeden korunur. |
| §3.4 Inbound | Evet | S1-S7 davranış matrisi somutlaştırır (bu doc §1). |
| §4 Guardrail | Hayır | Değişmeden korunur. |
| §5 Veri modeli | Evet | `leads.alternateEmails` field'ı eklenir (bu doc §6). |
| §6 v1 İnşa | Hayır | Geçmiş Phase'leri etkilemez. |

Bu delta SPECIFICATION.md'a v3'te konsolide edilirse, §3.1.2 ve §3.4 bölümleri **bu doc'un §1 + §2** ile genişler; §5 `leads` tablo şeması `alternateEmails` ile güncellenir.
