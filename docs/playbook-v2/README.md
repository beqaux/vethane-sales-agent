# Playbook v2 — Inbound Routing & Lead Merge İterasyonu

> **Tarih:** 2026-05-26
> **Tetik:** `grill-with-docs` oturumu (S1-S7 senaryoları + Karar #2 demo tanımı).
> **Hedef branch:** yeni feature branch (`feat/playbook-v2`) önerilir, ya da küçük PR'lara böl.
> **Tahmini efor:** ~14-18 saat (5 task, 1 ADR), 1 sprint.

---

## 0. TL;DR

Bu klasör, **mevcut çalışan ajanın** (saas-seller) davranışını **7 spesifik senaryo (S1-S7) etrafında** sıkılaştırır. Yeni özellik eklemez — mevcut karar ağacındaki kör noktaları ve doc-code drift'ini kapatır.

5 thematic task var:

| # | Task | Dokunulan dosyalar | Risk | Efor |
|---|---|---|---|---|
| **TG1** | Playbook routing v2 — premium detection + `satis_spami` + tür-öncelikli segment | `lib/playbooks/index.ts`, `lib/config/playbooks.ts`, `lib/adapters/ai.ts`, `lib/util/segment.ts`, `lib/domain/enums.ts`, `lib/domain/schemas.ts` | Orta (segment routing'in kalbi) | 5-6h |
| **TG2** | Low-confidence override | `lib/services/inbound.ts` | Düşük | 1h |
| **TG3** | Notify enrichment | `lib/services/notify.ts`, `lib/services/inbound.ts` | Düşük | 1.5h |
| **TG4** | Lead merge + `alternateEmails` | `lib/db/schema.ts`, drizzle migration, `lib/db/repositories/lead.ts`, `lib/services/inbound.ts`, `lib/domain/ports.ts`, `lib/domain/types.ts` | Orta-Yüksek (DB migration + idempotent lead) | 4-5h |
| **TG5** | Doc + pricing config | `docs/PRICING.md`, `lib/config/pricing.ts` | Düşük | 2-3h |

Bağımlılık zinciri:

```
TG1 ──┐
      ├── TG3 (TG1'in notify zenginleştirmesini kullanır)
TG2 ──┘
TG4 (izole — kendi başına)
TG5 (izole — doc + tablo, kod davranışını değiştirmez)
```

İdeal sıralama: **TG1 → TG2 → TG3 → TG4 → TG5** (paralel: TG4 ve TG5 ilk üçle eşzamanlı yürütülebilir).

---

## 1. Dosya Haritası

| Dosya | Amaç | Ne zaman okunmalı |
|---|---|---|
| [README.md](README.md) | Bu dosya — iterasyonun girişi | İlk |
| [SPEC-DELTA.md](SPEC-DELTA.md) | 7 senaryonun davranış matrisi, segment kuralı, yeni classification | Task'a başlamadan önce — niye |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Dosya-dosya patch'ler, helper imzaları, kod örnekleri | Task yürütürken — nasıl |
| [TASKS.md](TASKS.md) | TG1-TG5 atomic task tanımları + AC + dependencies | Hangi sırada, ne dokunulacak |
| [PROMPT.md](PROMPT.md) | Claude Code single-shot prompt — tüm 5 task tek oturumda | "Tek oturumda u̇çtan uca" execution |

İlgili (bu klasör dışı):
- [`docs/adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md`](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md) — Demo tanım değişikliği ADR
- [`CONTEXT.md`](../../CONTEXT.md) — karar #2 + §3 (zaten güncellendi, bu iterasyonun kararsal temeli)
- [`docs/PRICING.md`](../PRICING.md) — §10 TG5 ile güncellenecek

---

## 2. Bu İterasyonun Kararları (Kaynak: Handoff)

CONTEXT.md'de **zaten yazılmış** (bu iterasyon onu koda yansıtır):

1. **Karar #2 — Demo, sistem gösterimi olarak yeniden tanımlandı** (2-adımlı satış). Bkz. [ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md).
2. **§3 — Segment türetme tür-öncelikli oldu.** HASTANE ünvanı her zaman hospital; POLİKLİNİK ≥6 vet hospital, else mid; MUAYENEHANE ≤2 solo, =3 mid. Eski kod (vet-öncelikli) düzeltilecek.
3. **§3 — Detection katmanları açıklandı.** `fromEmail` domaini segment kararına girmez (TR'de küçük klinikler free-mail kullanıyor).

Senaryo-bazlı (henüz koda yansımadı, bu iterasyon yansıtır):

| # | Senaryo | Davranış | Hangi Task |
|---|---|---|---|
| S1 | Web inbound + fiyat sorusu | Premium sinyal (keyword `hastane\|poliklinik\|şube\|merkez\|zincir` veya AI `segmentGuess: mid/hospital`) varsa → mid playbook (sayısız + "kaç vet?" sor); yoksa → solo playbook (1-2 vet örnek + sayı sor). Auto. Her web inbound'da Telegram. | TG1 |
| S2 | Web inbound + demo isteği | Auto teyit + **zengin Telegram** (sender, mesaj özeti, AI confidence, segmentGuess, premium keyword match). | TG3 |
| S3 | Outbound + ilgili + segment unknown | Operasyonel kural (kod değişmez): unknown lead onay aşamasında reddedilsin. | (Doc'a yansır, kod yok) |
| S4 | Düşük confidence (<0.5) | Plan'ı manuel'e zorla, auto'ya geçme. | TG2 |
| S5 | Çıkış + unknown email | Kod doğru, değişiklik yok. | (no-op) |
| S6 | Aynı kurum farklı email | Domain-match ile lead birleştir; `leads.alternateEmails text[]` migration. | TG4 |
| S7 | Pazarlama/satış spam'i (başka SaaS'tan cold) | Yeni classification `satis_spami` (sendDraft=false, notify=false). | TG1 |

---

## 3. Bu İterasyonun NE Değiştirmediği (kasıt)

Sürtünmeyi düşürmek için kapsamı dar tuttuk. Bu turda dokunulmayacaklar:

- **Outbound sekans** (cold + takip akışı). Tüm değişiklik **inbound + config + segment routing** kapsamında.
- **Guardrail'ler** (`lib/guardrails/*`). Mid/hospital fiyat yasağı + suppression + opt-out doğru çalışıyor; korunuyor.
- **AI model seçimi** (`MODELS.draft = gemini-2.5-flash`, `MODELS.classify = haiku`). Doğrulanmadı, doğrulanmayacak.
- **Action modes** (`ACTION_MODES`). `solo_fiyat = auto` korunur; sadece **düşük confidence ile manuel override** TG2'de eklenecek.
- **Lead durum enum'ı** (`demo_izledi` gibi yeni state). ADR-0005 §4'te "v3'te ele alınacak" diye not düştü.
- **`docs/SPECIFICATION.md`, `docs/IMPLEMENTATION.md`, `docs/TASKS.md`, `docs/PROMPT.md`** (mevcut ana dokümanlar). Bu iterasyon **delta** olduğu için ayrı klasörde duruyor; karara bağlanırsa v3'te konsolide edilebilir.

---

## 4. Doğrulama (her task sonrası)

1. `pnpm typecheck` (zorunlu, sıfır hata).
2. `pnpm lint` (zorunlu, sıfır warning).
3. `pnpm test` ilgili task'in test dosyası geçer:
   - TG1 → `tests/playbooks.test.ts`, `tests/inbound.test.ts`, `tests/segment.test.ts` (segment.ts değişikliği).
   - TG2 → `tests/inbound.test.ts` (yeni: düşük confidence → manuel).
   - TG3 → `tests/inbound.test.ts` (notify.hot çağrı imzası).
   - TG4 → `tests/repositories/lead.test.ts` ya da yeni `tests/inbound-merge.test.ts`.
   - TG5 → text-grep doğrulama (`rg "demoda.*(teklif|harcama)"` 0 hit verir).
4. End-to-end manuel doğrulama (TG1-TG4 birlikte): `tests/compliance.e2e.test.ts` benzeri akış ya da staging'de gerçek mail gönderimi (S1+S2+S6 fixture'ları).

---

## 5. Hızlı Başlama

İki yol:

**A) Adım-adım manuel** (önerilen review için):
1. [TASKS.md](TASKS.md) aç → TG1'den başla → her task'i ayrı PR'a aç.
2. [IMPLEMENTATION.md](IMPLEMENTATION.md) ile dosya patch'lerini doğrula.
3. Her task sonrası §4 doğrulama.

**B) Tek-oturum Claude Code execution** (hızlı, daha az review):
1. [PROMPT.md](PROMPT.md) içeriğini bir Claude Code oturumuna yapıştır.
2. AI tüm 5 task'i tek oturumda yürütür.
3. PR açmadan önce §4 doğrulama + diff review.

---

## 6. Beklenen Çıktı (Bu İterasyon Bittiğinde)

- ✅ Web inbound + fiyat sorusu senaryosu (S1) doğru segment'e route oluyor.
- ✅ Web inbound + demo isteği (S2) zengin Telegram bildirimi gönderiyor.
- ✅ AI confidence <0.5 cevap → auto-mode bypass, manuel kuyruğa düşüyor (S4).
- ✅ Aynı kurum farklı email → tek lead, `alternateEmails` array'inde tutuluyor (S6).
- ✅ Başka SaaS cold mail (satis_spami) → no-op + düşük öncelik log (S7).
- ✅ `lib/util/segment.ts` tür-öncelikli kural uyguluyor (2 vet + hastane → hospital).
- ✅ PRICING.md ve playbooks.ts "demoda net teklif" ifadeleri 2-adımlı satışa göre güncellenmiş.
- ✅ `lib/config/pricing.ts` mid + hospital bantları da var (referans tablosu, AI vermez ama kurucu görür).
- ✅ ADR-0005 yazıldı, repo ADR hijyeni başladı.
