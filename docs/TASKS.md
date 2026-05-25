# Vethane Satış Ajanı — Tasks

> IMPLEMENTATION.md'den türetilen sıralı iş dökümü. Sırayla yürüt; her task tek oturumda biter.
> Refs: SPECIFICATION.md (SPEC), IMPLEMENTATION.md (IMPL).

## Summary
| Metric | Value |
|---|---|
| Toplam Task | 20 |
| Faz | 7 |
| Tahmini Efor | ~85-90 saat (~2-3 hafta solo) |
| Foundation biter | Task 4 |
| MVP (outbound+inbound döngü) biter | Task 14 |
| Tam v1 biter | Task 20 |

---

## Phase 1: Foundation
> Sonunda: proje derlenir/çalışır, DB + repo hazır; işlevsel akış yok.

### Task 1: Proje İskeleti
**Next.js 16 + TS strict iskeleti, bağımlılıklar, dizinler.**
**Files:** `package.json`, `tsconfig.json` (strict), `next.config.ts`, `.eslintrc`, `.prettierrc`, `.gitignore`, `.env.example`, `README.md`, IMPL §3.1'deki tüm dizinler (`.gitkeep`).
**Commands:** `pnpm dlx create-next-app@latest . --ts --app --no-tailwind` (UI yok, tailwind sonra), sonra IMPL §1.3 bağımlılıklarını ekle (`drizzle-orm drizzle-kit @neondatabase/serverless ai googleapis grammy cheerio papaparse zod`, dev: `vitest tsx @types/*`).
**AC:**
- [ ] `pnpm build` hatasız.
- [ ] `pnpm lint` ve `pnpm typecheck` geçer.
- [ ] `pnpm test` çalışır (0 test, 0 hata).
- [ ] `.env.example` IMPL §8.2 anahtarlarını içerir; `.gitignore` `.env`/`node_modules`/`.next` kapsar.
**Dependencies:** Yok · **Effort:** 2h · **Refs:** IMPL §1, §3.1

### Task 2: Domain Tipleri, Enum, Hata, Port, Util
**Tüm domain tipleri + arayüzler + saf yardımcılar.**
**Files:** `lib/domain/types.ts` (Lead, SequenceState, Message, DraftSpec, OutboundDraft, ReplyPlan, InboundMessage, Knowledge), `lib/domain/enums.ts` (Segment, Tier, Durum, Classification, ...), `lib/domain/errors.ts` (IMPL §7.1 kategorileri), `lib/domain/ports.ts` (EmailProvider, AiPort, repo arayüzleri), `lib/util/segment.ts` (segment+tier türetme), `lib/util/retry.ts`, `lib/util/email-parse.ts`, `lib/domain/schemas.ts` (zod: ClassificationSchema, webhook payload, config).
**Code:** Segment türetme SPEC §3.1.2 kuralları; `tier` türetme (poliklinik/hastane→1, 3-5 vet→2, solo→3). `any` yok.
**Tests:** `segment.test.ts` — vet sayısı + tür kombinasyonları → doğru segment/tier; unknown halleri.
**AC:**
- [ ] Tüm SPEC §5 varlıkları tipli, `any` yok.
- [ ] EmailProvider/AiPort/repo arayüzleri özellikleri karşılar.
- [ ] `deriveSegment(6,'hastane')→hospital/tier1`, `deriveSegment(2,null)→solo/tier3`, eksikse `unknown`.
- [ ] `pnpm test` geçer.
**Dependencies:** T1 · **Effort:** 3h · **Refs:** SPEC §2,§5,§3.1.2; IMPL §2,§7

### Task 3: DB Şeması + Migration
**Drizzle şema + Neon client + ilk migration.**
**Files:** `lib/db/schema.ts` (IMPL §4.1 tüm tablo/enum/indeks), `lib/db/client.ts` (Neon+Drizzle), `drizzle.config.ts`, ilk migration (`drizzle/`).
**Code:** `citext` extension; `leads`(tier/place_id/email_confidence/aday dahil), `sequence_state`, `messages`, `suppression`, `events`; IMPL §4.1 indeksleri.
**AC:**
- [ ] `pnpm drizzle-kit generate` migration üretir.
- [ ] `pnpm drizzle-kit migrate` boş Neon DB'de tüm tabloları kurar.
- [ ] `idx_seq_due`, `idx_leads_durum_tier`, `idx_leads_email` mevcut.
**Dependencies:** T2 · **Effort:** 3h · **Refs:** SPEC §5; IMPL §4

### Task 4: Repository'ler + Event Logger
**Tüm veri erişimi + olay loglama + testler.**
**Files:** `lib/db/repositories/{lead,sequence,message,suppression,event}.ts`, `lib/util/logger.ts` (event'e yazar), `tests/repositories/*.test.ts`.
**Code:** IMPL §4.3; `leadRepo.dueForSend(now,tiers)`, `byThread`, `upsertByEmail`; `suppressionRepo.has(email)`; `eventRepo.log(type,leadId,payload)`. Repo'lar domain tipi döner, Drizzle sızdırmaz.
**Tests:** Test DB (Neon branch) — CRUD + dueForSend filtreleri (status/tier/next_action_at) + suppression has.
**AC:**
- [ ] dueForSend yalnız active + tier∈tiers + next_action_at≤now + email!=null döner.
- [ ] upsertByEmail tekilleştirir.
- [ ] suppressionRepo.has doğru çalışır.
- [ ] `pnpm test` geçer.
**Dependencies:** T3 · **Effort:** 4h · **Refs:** IMPL §4.3

---

## Phase 2: Config & Knowledge
> Sonunda: tek-gerçek-kaynak kurallar + RAG korpusu hazır.

### Task 5: Config Modülleri + Bilgi Korpusu
**Fiyat/modül/playbook/warmup/notify/runtime config + Vethane bilgi md'leri.**
**Files:** `lib/config/{pricing,modules,playbooks,warmup,notify,runtime}.ts`, `lib/ai/knowledge/*.md` (konumlandırma, FAQ, itiraz cevapları — Vethane CONTEXT/ADR'lerinden), `tests/config.test.ts`.
**Code:** `pricing.ts` solo fiyat tablosu (taban 1950, Muhasebe 1950, İK 1550, Analitik 1050, Kafe 650, Doktor 260/vet — tunable); `runtime.ts` `activeTiers=[1]`, `actionModes` (hepsi `manual`), `seq={maxSteps:3,gapDays:4}`; `warmup.ts` `dailyCap` + ramp; zod ile config doğrulama (build-time).
**AC:**
- [ ] `getSoloPrice(modules)` config'ten deterministik toplam döner (AI yok).
- [ ] Config zod doğrulaması geçersiz değerde build'i kırar.
- [ ] knowledge md'leri yüklenebilir (knowledge loader).
**Dependencies:** T2 · **Effort:** 4h · **Refs:** SPEC §3.7,§2.2; IMPL §8.3

---

## Phase 3: Adapters (dış servisler)
> Sonunda: Gmail/AI/Telegram/Places kendi arayüzümüzün arkasında.

### Task 6: Gmail Adapter + Watch Kurulum
**GmailAdapter (EmailProvider) + bir-kerelik OAuth/watch scripti.**
**Files:** `lib/adapters/gmail.ts`, `scripts/setup-gmail-watch.ts`.
**Code:** IMPL §2.1 Adapter; googleapis ile OAuth2 (Internal, refresh_token), `createDraft/send/listHistory/addLabel/watch`. Script: OAuth consent (localhost redirect) → refresh_token yazdır + Pub/Sub topic'e watch kur. MIME decode `lib/util/email-parse`.
**Tests:** `email-parse` unit; adapter manuel/mock (gerçek Gmail entegrasyonu manuel doğrulama).
**AC:**
- [ ] `setup-gmail-watch` refresh_token üretir + watch döner (historyId+expiration).
- [ ] `createDraft` doğru thread'de taslak oluşturur (manuel doğrulama).
- [ ] `listHistory(startId)` yeni mesajları InboundMessage olarak döner.
- [ ] `addLabel` etiket uygular.
**Dependencies:** T2 · **Effort:** 7h · **Refs:** SPEC §3.3.1,§3.4.1; IMPL §2.1,§5.4

### Task 7: AI Adapter + Prompt Builder
**AiPort: writeDraft (Sonnet) + classify (Haiku) + prompt enjeksiyonu.**
**Files:** `lib/adapters/ai.ts`, `lib/ai/prompts.ts`, `tests/ai-prompts.test.ts`.
**Code:** AI SDK v6 + Gateway string (`anthropic/claude-sonnet-4-6` / `anthropic/claude-haiku-4-5`). `writeDraft(plan,lead)` → konu+gövde; `classify(msg)` → `generateObject` + ClassificationSchema. `prompts.ts` config (playbook/pricing) + knowledge digest enjekte eder; mid/hospital prompt'una "FİYAT/SAYI YAZMA" sert talimatı.
**Tests:** prompt builder — mid/hospital prompt'unda fiyat-yasağı talimatı var; solo prompt'una fiyat enjekte edilmiş; classify şema zorlanır.
**AC:**
- [ ] `classify` her zaman geçerli enum + confidence döner (şema zorlu).
- [ ] mid/hospital prompt'u fiyat-yasağı içerir; solo prompt'u config fiyatını içerir.
- [ ] Gateway hatası retry'lanır (`lib/util/retry`).
**Dependencies:** T2, T5 · **Effort:** 6h · **Refs:** SPEC §3.2.1,§3.4.2,§3.7; IMPL §2.2,§5.3

### Task 8: Telegram + Places Adapters
**Bildirim + lead sourcing dış servisleri.**
**Files:** `lib/adapters/telegram.ts`, `lib/adapters/places.ts`, `tests/places.test.ts`.
**Code:** Telegram: grammy ile `notify(text, links)` → TELEGRAM_CHAT_ID. Places: Text Search (şehir×sorgu) → {ad, website, phone, place_id} normalize; retry+rate-limit.
**Tests:** Places normalize (mock response → candidate alanları); telegram format birim testi.
**AC:**
- [ ] `notify` zengin mesaj (klinik/şehir/segment/alıntı/thread linki) gönderir (manuel doğrulama).
- [ ] Places sonucu place_id ile tekilleştirilmiş candidate'a map'lenir.
**Dependencies:** T2 · **Effort:** 4h · **Refs:** SPEC §3.5.1,§3.1.3; IMPL §2.1

---

## Phase 4: Core Domain Logic
> Sonunda: segment davranışı + güvenlik + sekans mantığı (saf, test edilmiş).

### Task 9: Playbook'lar (Strategy)
**solo/mid/hospital playbook'ları: buildOutbound + buildReply.**
**Files:** `lib/playbooks/{solo,mid,hospital,index}.ts`, `tests/playbooks.test.ts`.
**Code:** IMPL §2.2 Strategy. `solo`: outbound değer + (cevapta) config fiyatı + trial linki + opt-out + gönderen kimliği. `mid`/`hospital`: outbound discovery pivotu, **fiyat YOK**; reply → keşif sorusu + demo CTA. `index.playbookFor(segment)`.
**Tests:** mid/hospital plan'ında sayı yok; solo reply plan'ı fiyat referansı içerir; her plan opt-out + kimlik içerir.
**AC:**
- [ ] `playbookFor` segmente doğru strateji döner.
- [ ] mid/hospital outbound/ reply planı para içermez.
- [ ] solo cevap planı `getSoloPrice` kullanır (uydurma değil).
- [ ] `pnpm test` geçer.
**Dependencies:** T5 · **Effort:** 5h · **Refs:** SPEC §3.2.1,§3.4.2; IMPL §2.2

### Task 10: Guardrail Pipeline (KRİTİK)
**Giden taslak doğrulayıcıları (Chain of Responsibility).**
**Files:** `lib/guardrails/{suppressionCheck,noPriceForBigSegment,noPromises,requireOptOut,index}.ts`, `tests/guardrails.test.ts`.
**Code:** IMPL §2.3. `noPriceForBigSegment`: segment∈{mid,hospital} + para regex (`₺`, `\bTL\b`, sayı+para) → reject. `noPromises`: indirim/garanti/taahhüt kalıpları → reject. `requireOptOut`: cold mail'de opt-out satırı yoksa → reject. `suppressionCheck`: alıcı suppression'da → reject. `runGuardrails` ilk ret'te durur, event log.
**Tests:** (yoğun) mid taslağında "11.370₺"/"11370 TL"/"%10 indirim" → reject; solo taslağında fiyat → ok; opt-out'suz cold → reject; suppression'daki alıcı → reject.
**AC:**
- [ ] mid/hospital'da herhangi para formatı → reject (≥6 varyant testi).
- [ ] solo'da config fiyatı → ok.
- [ ] opt-out eksik cold → reject; suppression hit → reject.
- [ ] Ret `events`'e `guardrail_block` yazar.
**Dependencies:** T2, T4 · **Effort:** 4h · **Refs:** SPEC §3.6; IMPL §2.3

### Task 11: Sekans State Machine
**Sekans geçişleri: advance / onReply / stop / schedule.**
**Files:** `lib/services/sequence.ts`, `tests/sequence.test.ts`.
**Code:** IMPL §2.4. `advance` (step++ / completed), `onReply→stopped_replied`, `onOptout→stopped_optout`, `onOOO→ertele`, `next_action_at = +gapDays`.
**Tests:** maxSteps'te completed; reply→stop; optout→stop; gap doğru hesaplanır.
**AC:**
- [ ] `advance` son adımdan sonra `completed`, next_action_at null.
- [ ] reply/optout sekansı durdurur.
- [ ] OOO sekansı X gün erteler.
**Dependencies:** T2 · **Effort:** 3h · **Refs:** SPEC §3.2.2; IMPL §2.4

---

## Phase 5: Services & Routes (döngüler) — MVP
> Sonunda: outbound + inbound döngüleri uçtan uca çalışır (insan-onaylı). **MVP.**

### Task 12: Outbound Service + Cron
**Due-send → taslak → guardrail → Gmail taslak/gönder → sekans ilerlet.**
**Files:** `lib/services/outbound.ts`, `app/api/cron/outbound/route.ts`, `tests/outbound.test.ts`.
**Code:** IMPL §2.5. `processDue(now)`: `leadRepo.dueForSend(now, runtime.activeTiers)` → warmup `dailyCap` uygula → `playbookFor` plan → `ai.writeDraft` → `runGuardrails` (ret→skip+log) → `gmail.createDraft` + etiket → actionMode `auto` ise `gmail.send` → `sequence.advance` + message kaydı. Route: CRON_SECRET doğrula.
**Tests:** mock adapter/repo — guardrail ret'i gönderimi engeller; dailyCap aşılınca kalan ertelenir; auto modda send çağrılır, manual'da çağrılmaz.
**AC:**
- [ ] Cron yalnız tier∈activeTiers + due lead'leri işler.
- [ ] dailyCap aşılmaz.
- [ ] Guardrail ret → taslak gönderilmez/oluşturulmaz, event log.
- [ ] CRON_SECRET'siz istek 401.
**Dependencies:** T6,T7,T9,T10,T11 · **Effort:** 7h · **Refs:** SPEC §3.2,§3.3; IMPL §2.5,§5.1

### Task 13: Inbound Service + Gmail Webhook + Bildirim
**Pub/Sub push → history → classify → route → reply taslağı/notify.**
**Files:** `lib/services/inbound.ts`, `lib/services/notify.ts`, `app/api/webhooks/gmail/route.ts`, `tests/inbound.test.ts`.
**Code:** Route: Pub/Sub OIDC doğrula → hızlı 204 + `waitUntil(handle)`. `handle`: `gmail.listHistory` → lead eşle (byThread/email) → `ai.classify` → segment+sınıf route (SPEC §3.4.2): solo+fiyat→fiyat taslağı; mid/hospital→pivot taslağı; demo→notify+randevu taslağı+durum; cikis→suppression+sekans durdur; ilgisiz→durdur; oto_yanit→ertele. Taslak guardrail'den geçer. Düşük güven→notify, taslak yok.
**Tests:** her sınıf+segment yolu (mock); demo→notify çağrılır; cikis→suppressionRepo.add + sequence stop; mid+fiyat→fiyat içermeyen pivot taslağı.
**AC:**
- [ ] Geçersiz OIDC → 403; geçerli → 204 hızlı.
- [ ] demo → Telegram notify + durum=demo_istedi.
- [ ] cikis → suppression + sekans stopped_optout.
- [ ] mid/hospital cevabı asla fiyat taslağı üretmez (guardrail+playbook).
**Dependencies:** T6,T7,T8,T9,T10,T11 · **Effort:** 8h · **Refs:** SPEC §3.4,§3.5,§3.6; IMPL §5.2

### Task 14: Watch-Renew + Yedek Polling + Health
**Operasyonel cron'lar + sağlık ucu.**
**Files:** `app/api/cron/watch-renew/route.ts`, `app/api/cron/poll-sent/route.ts`, `app/api/health/route.ts`.
**Code:** watch-renew: `gmail.watch()` çağır, historyId sakla. poll-sent: gönderilen taslakları (status sent) + kaçan cevapları yokla (yedek). health: DB ping + son cron zamanı.
**AC:**
- [ ] watch-renew watch'ı yeniler, yeni expiration loglar.
- [ ] poll-sent push'la gelmeyen cevabı yakalar (manuel senaryo).
- [ ] `/api/health` 200 + DB:ok.
**Dependencies:** T6,T13 · **Effort:** 3h · **Refs:** SPEC §3.4.1,§11.4; IMPL §11

---

## Phase 6: Lead Pipeline
> Sonunda: hedef listesi sıfırdan üretilebilir + zenginleştirilebilir + içe alınabilir.

### Task 15: Sourcing Service + Script
**Places + sicil → aday lead.**
**Files:** `lib/services/sourcing.ts`, `scripts/source-leads.ts`, `tests/sourcing.test.ts`.
**Code:** SPEC §3.1.3. Places (şehir×sorgu) + sicil CSV (papaparse) → ad+şehir eşleştir → `durum=aday` lead upsert (place_id tekil). Script CLI: şehir listesi parametresi.
**Tests:** Places+sicil birleştirme tekilleştirir; aday alanları doğru.
**AC:**
- [ ] `source-leads` aday lead'leri DB'ye yazar (durum=aday, place_id tekil).
- [ ] Sicil CSV Places ile ad+şehir üzerinden eşleşir.
**Dependencies:** T4,T8 · **Effort:** 5h · **Refs:** SPEC §3.1.3

### Task 16: Enrichment Service + Script
**Website kazıma → e-posta + confidence.**
**Files:** `lib/services/enrichment.ts`, `scripts/enrich-leads.ts`, `tests/enrichment.test.ts`.
**Code:** SPEC §3.1.4. website varsa ana sayfa+`/iletisim`/`/contact` çek (cheerio) → mailto+regex → email_confidence=high; yoksa domain'den `info@domain`=low; hiç yoksa işaretle. Nazik çekme (timeout, rate-limit).
**Tests:** mailto'lu HTML → high; e-postasız+domain → info@ low; e-postasız+domainsiz → flag.
**AC:**
- [ ] Sabit HTML fixture'dan doğru e-posta + confidence.
- [ ] info@domain fallback yalnız domain varken.
- [ ] Hatalı/timeout site atlanır + loglanır.
**Dependencies:** T4 · **Effort:** 4h · **Refs:** SPEC §3.1.4

### Task 17: Seed Import + Aday İnceleme Export
**CSV seed import + aday onay/export.**
**Files:** `scripts/import-seed.ts`, `scripts/export-candidates.ts`, `tests/import.test.ts`.
**Code:** SPEC §3.1.1,§3.1.5. import-seed: CSV→leads (dedup, suppression kontrol, segment+tier türet, durum=yeni); export-candidates: durum=aday'ları CSV'ye (low-confidence işaretli) ki kurucu onaylasın; onaylanan satırlar `yeni` yapılır.
**Tests:** geçersiz e-posta atlanır; suppression'daki → cikti; segment+tier türetilir.
**AC:**
- [ ] Seed CSV doğru parse + upsert; geçersizler raporlanır.
- [ ] Suppression'daki adres sekansa alınmaz.
- [ ] export-candidates low-confidence'ı işaretler.
**Dependencies:** T4 · **Effort:** 4h · **Refs:** SPEC §3.1.1,§3.1.5

---

## Phase 7: Compliance, Deploy, Release

### Task 18: Uçtan Uca Uyumluluk Testleri
**Opt-out + suppression + kimlik bütünleşik doğrulama.**
**Files:** `tests/compliance.e2e.test.ts`.
**Code:** Senaryo: cold gönder→cikis cevabı→suppression→aynı lead'e bir daha gönderilmez; her cold mailde opt-out satırı; suppression hit gönderimi engeller.
**AC:**
- [ ] cikis sonrası lead suppression'da + sekans durur + tekrar gönderim yok.
- [ ] Tüm cold taslaklarda opt-out satırı (guardrail geçişli).
- [ ] `pnpm test` tüm suite geçer.
**Dependencies:** T12,T13 · **Effort:** 3h · **Refs:** SPEC §3.6; IMPL §10

### Task 19: Deploy Config + Ops Runbook
**Vercel cron + env + deploy + kurucu kılavuzu.**
**Files:** `vercel.json` (IMPL §11 cron'ları), `README.md` (kurulum+runbook: Workspace migrasyon, Google Cloud OAuth/Pub-Sub, Neon, Telegram, env), `.env.example` güncel.
**AC:**
- [ ] `vercel.json` 3 cron tanımlı (outbound saatlik, watch-renew 6 günde, poll-sent 10dk).
- [ ] README Faz-0 hesap kurulumunu adım-adım anlatır.
- [ ] Preview deploy'da `/api/health` 200.
**Dependencies:** T14 · **Effort:** 3h · **Refs:** IMPL §11,§12

### Task 20: CI + Final Smoke + Doc Polish
**CI pipeline + uçtan uca smoke + dokümanları senkronla.**
**Files:** `.github/workflows/ci.yml`, `docs/*` güncel, `README` final.
**Code:** CI: lint→typecheck→test→build. Smoke: sandbox lead ile 1 outbound taslak Gmail'de görünür + 1 sahte cevap → sınıflanır → (demo ise) Telegram'a düşer (staging).
**AC:**
- [ ] CI PR'da yeşil (lint+typecheck+test+build).
- [ ] Smoke: taslak Gmail'de + demo cevabı Telegram bildirimi (manuel doğrulama).
- [ ] docs SPEC/IMPL/TASKS son haliyle tutarlı.
**Dependencies:** T18,T19 · **Effort:** 3h · **Refs:** IMPL §9.3,§11.4

---

## Milestones
| Milestone | After | Achieved | Demo? |
|---|---|---|---|
| Foundation | T4 | Derlenir, DB+repo çalışır | Smoke |
| Adapters | T8 | Gmail/AI/Telegram/Places hazır | Adapter çağrısı |
| Core logic | T11 | Playbook+guardrail+sekans test'li | Unit suite |
| **MVP** | **T14** | **Outbound+inbound döngü, insan-onaylı, demo→Telegram** | **Tam akış** |
| Lead pipeline | T17 | Liste sıfırdan üretilir/zenginleşir/import | Lead DB dolu |
| Release | T20 | Prod-hazır, CI, runbook | Ship |

## Dependency Graph
```
T1→T2→T3→T4
   T2→T5→T7
   T2→T6 ; T2→T8
T5→T9 ; (T2,T4)→T10 ; T2→T11
(T6,T7,T9,T10,T11)→T12
(T6,T7,T8,T9,T10,T11)→T13→T14
(T4,T8)→T15 ; T4→T16 ; T4→T17
(T12,T13)→T18→? ; T14→T19 ; (T18,T19)→T20
```
