# Vethane Satış Ajanı — Claude Code Implementation Prompt

> Bu prompt kendinden-yeterlidir. Sıfır repo'dan deploy-edilebilir v1'e kadar her şeyi içerir. Sırayla yürüt; checkpoint'lerde doğrula.

## Proje Özeti
Vethane (TR veteriner **işletme yönetimi** SaaS'ı) için, kurucu yerine satış yapan **çift-modlu, insan-onaylı, Gmail-yerel** bir AI satış ajanı kur. Ajan: (1) küratörlü hedef klinik listesine kişisel **cold e-posta sekansı** atar (Gmail taslağı olarak — kurucu onaylar); (2) gelen cevapları **sınıflar ve yanıtlar** — `solo` segmente açık fiyat+trial verir, `mid`/`hospital` segmente **fiyat vermez** (keşif sorusu + demo'ya çeker), demo isteğinde kurucuya **Telegram** bildirir. Kritik kural: AI fiyat **uydurmaz** (config'ten çeker) ve kod-seviyesi **guardrail** mid/hospital taslağında sayı/söz geçmesini engeller.

**Hedefleme:** Tier 1 = 250 premium (poliklinik+hastane) ile başla; lead modeli tier taşır (genişleme = config). Solo cold'a alınmaz (self-servis inbound).

## Tech Stack
| Layer | Technology | Version |
|---|---|---|
| Dil/Runtime | TypeScript / Node | 5.x / 24 LTS |
| Framework | Next.js (App Router) | 16 |
| DB | Neon Postgres + Drizzle ORM | latest |
| AI | AI SDK + Vercel AI Gateway | 6 |
| Modeller | `anthropic/claude-sonnet-4-6` (taslak), `anthropic/claude-haiku-4-5` (sınıflama) | — |
| Gmail/PubSub | googleapis | latest |
| Telegram | grammy | latest |
| Scraping/CSV | cheerio / papaparse | latest |
| Validation | zod | 4.x |
| Test | vitest + tsx | latest |
| Hosting | Vercel (Fluid Compute, Cron) | — |

> Sürümleri scaffold anında `@latest` ile en güncel stabile sabitle; major hatlar yukarıdaki gibi.

## Proje Yapısı
```
saas-seller/
├── app/api/
│   ├── cron/outbound/route.ts        # due-send işle
│   ├── cron/watch-renew/route.ts     # Gmail watch yenile
│   ├── cron/poll-sent/route.ts       # yedek polling
│   ├── webhooks/gmail/route.ts       # Pub/Sub push → inbound
│   ├── webhooks/telegram/route.ts    # (Faz3) buton
│   └── health/route.ts
├── lib/
│   ├── domain/        # types.ts enums.ts errors.ts ports.ts schemas.ts
│   ├── db/            # schema.ts client.ts repositories/{lead,sequence,message,suppression,event}.ts
│   ├── adapters/      # gmail.ts ai.ts telegram.ts places.ts
│   ├── playbooks/     # solo.ts mid.ts hospital.ts index.ts
│   ├── guardrails/    # suppressionCheck.ts noPriceForBigSegment.ts noPromises.ts requireOptOut.ts index.ts
│   ├── services/      # outbound.ts inbound.ts sequence.ts sourcing.ts enrichment.ts notify.ts
│   ├── ai/            # prompts.ts knowledge/*.md
│   ├── config/        # pricing.ts modules.ts playbooks.ts warmup.ts notify.ts runtime.ts
│   └── util/          # retry.ts logger.ts segment.ts email-parse.ts
├── scripts/           # setup-gmail-watch.ts source-leads.ts enrich-leads.ts import-seed.ts export-candidates.ts
├── drizzle/           # migrations
├── docs/              # SPECIFICATION/IMPLEMENTATION/TASKS/PROMPT (mevcut) ; CONTEXT.md kökte
├── tests/
├── .env.example  drizzle.config.ts  vercel.json  package.json  README.md
```

## Bağımlılıklar
```bash
pnpm dlx create-next-app@latest . --ts --app --eslint --no-tailwind --src-dir=false --import-alias "@/*"
pnpm add drizzle-orm @neondatabase/serverless ai googleapis grammy cheerio papaparse zod
pnpm add -D drizzle-kit tsx vitest @types/papaparse
```

## Config Dosyaları

### tsconfig.json (strict — create-next-app çıktısına ekle/doğrula)
```json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, "paths": { "@/*": ["./*"] } } }
```

### drizzle.config.ts
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./lib/db/schema.ts", out: "./drizzle", dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

### vercel.json
```json
{ "crons": [
  { "path": "/api/cron/outbound", "schedule": "0 * * * *" },
  { "path": "/api/cron/watch-renew", "schedule": "0 6 */6 * *" },
  { "path": "/api/cron/poll-sent", "schedule": "*/10 * * * *" }
]}
```

### .env.example
```
DATABASE_URL=
AI_GATEWAY_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
SENDER_EMAIL=info@vethane.com
SENDER_NAME=
PUBSUB_TOPIC=
PUBSUB_AUDIENCE=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
GOOGLE_PLACES_API_KEY=
CRON_SECRET=
```

## Veri Modeli (ilk migration'a kopyala)
```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE TYPE segment AS ENUM ('solo','mid','hospital','unknown');
CREATE TYPE kurum_tur AS ENUM ('muayenehane','poliklinik','hastane');
CREATE TYPE lead_durum AS ENUM ('aday','yeni','sekansta','cevap_geldi','demo_istedi','kazanildi','kaybedildi','cikti');
CREATE TYPE seq_status AS ENUM ('active','paused','stopped_replied','stopped_optout','completed');
CREATE TYPE msg_dir AS ENUM ('out','in');
CREATE TYPE classification AS ENUM ('fiyat','demo','ilgili','ilgisiz','oto_yanit','cikis');
CREATE TYPE msg_status AS ENUM ('draft','approved','sent','rejected');
CREATE TYPE supp_reason AS ENUM ('optout','bounce','manual');

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kurum_adi TEXT NOT NULL, sehir TEXT, tur kurum_tur, vet_sayisi INT,
  segment segment NOT NULL DEFAULT 'unknown', tier INT NOT NULL DEFAULT 1,
  email CITEXT, email_confidence TEXT, website TEXT, place_id TEXT UNIQUE,
  phone TEXT, instagram TEXT, karar_verici TEXT, kaynak TEXT,
  durum lead_durum NOT NULL DEFAULT 'aday', gmail_thread_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_leads_email ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX idx_leads_durum_tier ON leads(durum, tier);

CREATE TABLE sequence_state (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  current_step INT NOT NULL DEFAULT 0, next_action_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ, status seq_status NOT NULL DEFAULT 'active'
);
CREATE INDEX idx_seq_due ON sequence_state(status, next_action_at);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direction msg_dir NOT NULL, gmail_message_id TEXT, subject TEXT, body TEXT,
  classification classification, status msg_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_lead ON messages(lead_id, created_at);

CREATE TABLE suppression (email CITEXT PRIMARY KEY, reason supp_reason NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  type TEXT NOT NULL, payload_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX idx_events_type ON events(type, created_at);
```

## Çekirdek Kod Taslakları (referans — adımlarda kullan)

**Adapter port (lib/domain/ports.ts):**
```ts
export interface EmailProvider {
  createDraft(threadId: string | null, to: string, subject: string, body: string): Promise<string>;
  send(draftId: string): Promise<string>;
  listHistory(startHistoryId: string): Promise<InboundMessage[]>;
  addLabel(threadId: string, label: string): Promise<void>;
  watch(): Promise<{ historyId: string; expiration: number }>;
}
export interface AiPort {
  writeDraft(plan: DraftSpec, lead: Lead): Promise<{ subject: string; body: string }>;
  classify(msg: InboundMessage): Promise<{ cls: Classification; confidence: number; segmentGuess?: Segment }>;
}
```

**Strategy seçici (lib/playbooks/index.ts):**
```ts
export const playbookFor = (s: Segment): Playbook =>
  s === "solo" ? soloPlaybook : s === "mid" ? midPlaybook : hospitalPlaybook;
// solo: cevapta getSoloPrice(modules) + trial linki. mid/hospital: FİYAT YOK → discovery pivot + demo CTA.
```

**Guardrail pipeline (lib/guardrails/index.ts):**
```ts
export type Guardrail = (d: OutboundDraft, ctx: Ctx) => { ok: true } | { ok: false; reason: string };
export const guardrails: Guardrail[] = [suppressionCheck, noPriceForBigSegment, noPromises, requireOptOut];
export function runGuardrails(d: OutboundDraft, ctx: Ctx) {
  for (const g of guardrails) { const r = g(d, ctx); if (!r.ok) return r; } return { ok: true as const };
}
// noPriceForBigSegment: ctx.lead.segment ∈ {mid,hospital} && /(?:₺|\bTL\b|\d[\d.\s]*\s?(?:tl|lira|₺))/i.test(body) → reject
```

**State machine (lib/services/sequence.ts):**
```ts
export const onReply = (s: SequenceState): SequenceState => ({ ...s, status: "stopped_replied", next_action_at: null });
export const onOptout = (s: SequenceState): SequenceState => ({ ...s, status: "stopped_optout", next_action_at: null });
export function advance(s: SequenceState, cfg: { maxSteps: number; gapDays: number }): SequenceState {
  const next = s.current_step + 1;
  return next > cfg.maxSteps
    ? { ...s, status: "completed", next_action_at: null }
    : { ...s, current_step: next, last_sent_at: new Date(), next_action_at: addDays(new Date(), cfg.gapDays) };
}
```

**Outbound service (lib/services/outbound.ts):**
```ts
async processDue(now: Date) {
  let sent = 0;
  for (const lead of await this.leads.dueForSend(now, runtime.activeTiers)) {
    if (sent >= warmup.dailyCap) break;
    const plan = playbookFor(lead.segment).buildOutbound(lead, lead.step, this.kb);
    const draft = await this.ai.writeDraft(plan, lead);
    const g = runGuardrails({ ...draft, segment: lead.segment, isCold: lead.step === 0 }, { lead, suppressed: await this.supp.has(lead.email!) });
    if (!g.ok) { await this.events.log("guardrail_block", lead.id, g); continue; }
    const draftId = await this.mail.createDraft(lead.gmail_thread_id, lead.email!, draft.subject, draft.body);
    await this.mail.addLabel(lead.gmail_thread_id!, "vethane/sekansta");
    if (runtime.actionModes[plan.action] === "auto") await this.mail.send(draftId);
    await this.seq.save(advance(lead.seq, runtime.seq)); sent++;
  }
}
```

**Pub/Sub webhook (app/api/webhooks/gmail/route.ts):**
```ts
export async function POST(req: Request) {
  if (!verifyPubSubOIDC(req)) return new Response("forbidden", { status: 403 });
  const { message } = await req.json();
  waitUntil(inboundService.handle(JSON.parse(atob(message.data)))); // {emailAddress, historyId}
  return new Response(null, { status: 204 });
}
```

**Sınıflama şeması (lib/domain/schemas.ts):**
```ts
export const ClassificationSchema = z.object({
  cls: z.enum(["fiyat","demo","ilgili","ilgisiz","oto_yanit","cikis"]),
  confidence: z.number().min(0).max(1),
  segmentGuess: z.enum(["solo","mid","hospital","unknown"]).optional(),
});
```

## Uygulama Sırası

### Step 1 — İskelet
**Files:** package.json, tsconfig.json, .eslintrc, .prettierrc, .gitignore, .env.example, README.md, tüm dizinler.
Yukarıdaki bağımlılık komutlarını çalıştır; config dosyalarını yaz. **Tests:** yok.

### Step 2 — Domain + util
**Files:** lib/domain/{types,enums,errors,ports,schemas}.ts, lib/util/{retry,email-parse,segment}.ts, tests/segment.test.ts
Tüm tipler/enum'lar; `deriveSegment(vet,tur)` + `deriveTier`; ClassificationSchema. `any` yok. **Tests:** segment/tier kombinasyonları + unknown.

### Step 3 — DB şeması
**Files:** lib/db/schema.ts (yukarıdaki SQL'in Drizzle karşılığı), lib/db/client.ts, drizzle.config.ts, drizzle/ migration.
**Tests:** `pnpm drizzle-kit migrate` boş DB'de tüm tabloları kurar.

### Step 4 — Repository'ler + logger
**Files:** lib/db/repositories/*.ts, lib/util/logger.ts, tests/repositories/*.test.ts
`leadRepo.dueForSend(now,tiers)`, `byThread`, `upsertByEmail`; `suppressionRepo.has`; `eventRepo.log`.
**🔍 Checkpoint:** `pnpm build` + `pnpm test` geçer; migration temiz; dueForSend filtreleri doğru.

### Step 5 — Config + knowledge
**Files:** lib/config/*.ts, lib/ai/knowledge/*.md, tests/config.test.ts
`pricing.ts` solo tablo (taban 1950 / Muhasebe 1950 / İK 1550 / Analitik 1050 / Kafe 650 / Doktor 260/vet); `runtime.ts` activeTiers=[1], actionModes hepsi 'manual', seq{maxSteps:3,gapDays:4}; warmup dailyCap; zod build-time doğrulama. **Tests:** getSoloPrice deterministik.

### Step 6 — Gmail adapter + watch script
**Files:** lib/adapters/gmail.ts, scripts/setup-gmail-watch.ts
EmailProvider impl (googleapis, OAuth Internal refresh_token). Script: OAuth consent (localhost) → refresh_token + Pub/Sub watch. **Tests:** email-parse unit; adapter manuel.

### Step 7 — AI adapter + prompts
**Files:** lib/adapters/ai.ts, lib/ai/prompts.ts, tests/ai-prompts.test.ts
AI SDK v6 Gateway string; writeDraft (Sonnet), classify (Haiku, generateObject+ClassificationSchema). prompts: config+knowledge enjekte; **mid/hospital prompt'una "FİYAT/SAYI YAZMA" talimatı**. **Tests:** mid prompt fiyat-yasağı içerir; solo prompt fiyat içerir.

### Step 8 — Telegram + Places
**Files:** lib/adapters/telegram.ts, lib/adapters/places.ts, tests/places.test.ts
notify(text,links); Places Text Search → candidate normalize (place_id tekil).
**🔍 Checkpoint:** Tüm adapter'lar derlenir + birim testleri geçer.

### Step 9 — Playbook'lar
**Files:** lib/playbooks/{solo,mid,hospital,index}.ts, tests/playbooks.test.ts
solo: değer + fiyat (config) + trial + opt-out + gönderen kimliği. mid/hospital: discovery pivot, **fiyat yok**. **Tests:** mid/hospital planında sayı yok; solo getSoloPrice kullanır; her planda opt-out + kimlik.

### Step 10 — Guardrail pipeline (KRİTİK)
**Files:** lib/guardrails/*.ts, tests/guardrails.test.ts
noPriceForBigSegment, noPromises, requireOptOut, suppressionCheck; runGuardrails ilk ret'te durur + event log.
**Tests (yoğun):** mid'de "11.370₺"/"11370 TL"/"%10 indirim" → reject (≥6 varyant); solo fiyatı → ok; opt-out'suz cold → reject; suppression hit → reject.

### Step 11 — Sekans state machine
**Files:** lib/services/sequence.ts, tests/sequence.test.ts
advance/onReply/onOptout/onOOO. **Tests:** maxSteps→completed; reply/optout→stop; gap doğru.
**🔍 Checkpoint:** Çekirdek mantık (playbook+guardrail+sekans) tam test'li; suite yeşil.

### Step 12 — Outbound service + cron
**Files:** lib/services/outbound.ts, app/api/cron/outbound/route.ts, tests/outbound.test.ts
Yukarıdaki processDue taslağı; warmup cap; actionMode auto→send. Route CRON_SECRET. **Tests:** guardrail ret→gönderim yok; cap aşılmaz; CRON_SECRET'siz→401.

### Step 13 — Inbound service + webhook + notify
**Files:** lib/services/inbound.ts, lib/services/notify.ts, app/api/webhooks/gmail/route.ts, tests/inbound.test.ts
Pub/Sub OIDC→204+waitUntil; handle: history→eşle→classify→route (solo+fiyat→fiyat taslağı; mid/hospital→pivot; demo→notify+randevu taslağı+durum; cikis→suppress+stop; ilgisiz→stop; oto_yanit→ertele); taslak guardrail'den geçer; düşük güven→notify. **Tests:** her sınıf/segment yolu; demo→notify; cikis→suppress+stop; mid+fiyat→fiyatsız pivot.

### Step 14 — Watch-renew + poll + health
**Files:** app/api/cron/{watch-renew,poll-sent}/route.ts, app/api/health/route.ts
**🔍 Checkpoint — MVP:** Outbound+inbound döngüleri uçtan uca çalışır; sandbox lead → Gmail taslağı; sahte demo cevabı → Telegram bildirim.

### Step 15 — Sourcing
**Files:** lib/services/sourcing.ts, scripts/source-leads.ts, tests/sourcing.test.ts
Places + sicil CSV → durum=aday lead (place_id tekil). **Tests:** birleştirme tekilleştirir.

### Step 16 — Enrichment
**Files:** lib/services/enrichment.ts, scripts/enrich-leads.ts, tests/enrichment.test.ts
website çek (cheerio) → email + confidence; yoksa info@domain=low; nazik çekme. **Tests:** fixture HTML → doğru email/confidence.

### Step 17 — Seed import + aday export
**Files:** scripts/{import-seed,export-candidates}.ts, tests/import.test.ts
CSV→leads (dedup, suppression kontrol, segment+tier türet); aday→CSV (low işaretli)→onaylı=yeni.
**🔍 Checkpoint:** Lead DB sıfırdan doldurulabilir; pipeline çalışır.

### Step 18 — Uyumluluk e2e
**Files:** tests/compliance.e2e.test.ts
cold→cikis→suppression→tekrar gönderim yok; her cold'da opt-out; suppression engeller.

### Step 19 — Deploy config + runbook
**Files:** vercel.json, README.md (Faz-0: Workspace migrasyon, Google Cloud OAuth/Pub-Sub, Neon, Telegram, env), .env.example.

### Step 20 — CI + smoke + doc
**Files:** .github/workflows/ci.yml (lint→typecheck→test→build), README final.
**🔍 Checkpoint — Release:** CI yeşil; smoke (taslak Gmail'de + demo→Telegram); docs tutarlı.

## API Referansı
| Method | Path | Auth | Açıklama |
|---|---|---|---|
| POST | /api/cron/outbound | CRON_SECRET | due-send işle |
| POST | /api/cron/watch-renew | CRON_SECRET | Gmail watch yenile |
| POST | /api/cron/poll-sent | CRON_SECRET | yedek polling |
| POST | /api/webhooks/gmail | Pub/Sub OIDC | inbound (204+waitUntil) |
| GET | /api/health | — | DB:ok + son cron |

## Hata Yönetimi
| Kategori | Aksiyon | Log |
|---|---|---|
| Geçici dış (Gmail/AI/TG 5xx) | retry+backoff | event Warn |
| AI şema fail | retry→kuyrukta beklet | event Warn |
| Guardrail block | taslağı reddet/yeniden üret | event `guardrail_block` |
| Auth (refresh geçersiz) | dur + Telegram alarm | event Error |
| Bounce | suppression(bounce) | event Info |
| İç (DB) | retry; sonra 5xx | event Error |

## Auth Flow (Gmail OAuth Internal)
```
1. scripts/setup-gmail-watch → OAuth consent (Internal app, localhost redirect) → refresh_token
2. refresh_token env'e; access_token gerektikçe yenilenir
3. Google Cloud: Pub/Sub topic + push subscription → /api/webhooks/gmail (PUBSUB_AUDIENCE)
4. watch() 6 günde bir cron ile yenilenir
```

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| DATABASE_URL | ✅ | Neon |
| AI_GATEWAY_API_KEY | ✅ | Vercel AI Gateway |
| GOOGLE_CLIENT_ID/SECRET, GMAIL_REFRESH_TOKEN | ✅ | Gmail OAuth Internal |
| SENDER_EMAIL/NAME | ✅ | info@vethane.com + kimlik |
| PUBSUB_TOPIC/AUDIENCE | ✅ | inbound push |
| TELEGRAM_BOT_TOKEN/CHAT_ID | ✅ | bildirim |
| GOOGLE_PLACES_API_KEY | ✅ | sourcing |
| CRON_SECRET | ✅ | cron koruması |

## Test Gereksinimleri
- **Birim:** guardrails (kritik, çok varyant), sequence, segment, enrichment, prompt builder.
- **Entegrasyon:** outbound.processDue + inbound.handle (tüm sınıf/segment yolları, mock adapter + test DB).
- **e2e:** uyumluluk (opt-out→suppression→tekrar yok).
- Çalıştır: `pnpm test`.

## Kalite Kontrolleri (sonda)
- [ ] `pnpm lint` 0 uyarı, `pnpm typecheck` temiz.
- [ ] `pnpm test` 0 hata; guardrail testleri mid/hospital'da her para formatını yakalar.
- [ ] `pnpm build` prod artefakt üretir.
- [ ] `drizzle-kit migrate` boş DB'de temiz çalışır.
- [ ] Sandbox lead → Gmail taslağı oluşur; sahte demo cevabı → Telegram bildirimi düşer.
- [ ] **mid/hospital için hiçbir koşulda fiyat/sayı içeren mail gönderilemez** (guardrail + playbook + prompt üçlü koruma).
- [ ] Her cold mailde opt-out satırı; suppression gönderimi engeller.
- [ ] README Faz-0 hesap kurulumunu eksiksiz anlatır.

## Önemli Davranış Kuralları (asla ihlal etme)
1. **mid/hospital'a fiyat/sayı yok** — prompt + playbook + guardrail üçlü.
2. **Fiyat AI tarafından üretilmez** — yalnız `pricing` config'ten çekilir (solo).
3. **v1'de hiçbir mail otomatik gitmez** (actionModes='manual') — Gmail taslağı olarak kurucu onayına sunulur.
4. **Her gönderimden önce suppression kontrolü** + her cold mailde opt-out.
5. **Webhook her zaman hızlı 2xx/204** döner; iş `waitUntil`'de.
6. **Sadece Tier 1** işlenir (activeTiers=[1]); genişleme config değişikliğidir.
```
