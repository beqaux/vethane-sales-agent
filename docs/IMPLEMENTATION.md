# Vethane Satış Ajanı — Implementation Plan

> SPECIFICATION.md'den türetilen teknik blueprint. Kararlar `../CONTEXT.md`'de kesinleşti; burada **nasıl** inşa edileceğini tanımlarız.
> **Not:** Sürüm satırları scaffold anında "latest stable"a sabitlenir; major hatlar Vercel platform güncellemesine göre (Next 16, AI SDK 6, Node 24).

## 1. Tech Stack

### 1.1 Stack Summary
| Layer | Technology | Version | Rationale |
|---|---|---|---|
| Dil | TypeScript | 5.x | Tek dil (backend + gelecekteki UI), tip güvenliği guardrail/state için kritik |
| Runtime | Node.js | 24 LTS | Vercel Fluid Compute varsayılanı |
| Framework | Next.js (App Router) | 16 | Route handler = cron/webhook; UI sonra aynı projeye eklenir (SPEC §7) |
| Hosting | Vercel (Fluid Compute) | — | Cron + webhook + fonksiyon yönetilen; CONTEXT karar #11 |
| DB | Neon Postgres | — | Serverless PG; lead/durum (SPEC §5); Marketplace |
| DB driver | @neondatabase/serverless | latest | Serverless/HTTP-WS uçları için |
| ORM | Drizzle ORM | latest | SQL-yakın, hafif, edge-uyumlu, TS-native; migration üretir |
| AI | AI SDK | 6 | generateText/generateObject; taslak + sınıflama (SPEC §3.2,§3.4) |
| AI erişim | Vercel AI Gateway | — | `"anthropic/claude-..."` string; gözlem + fallback (knowledge-update) |
| Modeller | Claude Sonnet 4.6 / Haiku 4.5 | — | Sonnet=taslak, Haiku=sınıflama (ucuz/sık) |
| Gmail/Pub-Sub | googleapis | latest | Resmi istemci: gmail.users.* + watch |
| Telegram | grammy | latest | TS-first; v1 send-only, Faz-3 buton callback |
| Scraping | cheerio | latest | Enrichment: website HTML'den e-posta (SPEC §3.1.4) |
| CSV | papaparse | latest | Seed/sicil import (SPEC §3.1.1, §3.1.3) |
| Validation | zod | 4.x | Webhook payload + AI çıktısı + config şema |
| Test | Vitest | latest | Unit (guardrail/state/segment) + servis entegrasyon |
| Lint/format | ESLint + Prettier | latest | Next varsayılan + Prettier |

### 1.2 Key Technical Decisions

#### Decision: ORM = Drizzle (Prisma/raw değil)
- **Context:** SPEC §5 ilişkisel veri; serverless'te düşük cold-start.
- **Options:** 1) Prisma — DX iyi ama ağır runtime/engine; 2) Drizzle — hafif, SQL-yakın, edge-uyumlu; 3) raw SQL — tam kontrol, çok boilerplate.
- **Choice:** Drizzle.
- **Rationale:** Serverless'te hafiflik + tip-güvenli sorgu + migration üretimi; Neon ile yaygın eşleşme.
- **Consequences:** İlişki sorguları biraz daha elle; küçük şema için sorun değil.

#### Decision: AI erişimi = AI Gateway provider-string
- **Context:** SPEC §3.2/§3.4; sağlayıcı bağımsızlığı + gözlem.
- **Choice:** `generateText({ model: "anthropic/claude-sonnet-4-6", ... })` Gateway üzerinden; `@ai-sdk/anthropic` doğrudan değil.
- **Rationale:** Model değişimi tek satır, fallback/observability/maliyet izleme bedava (Vercel knowledge-update).
- **Consequences:** Gateway'e bağımlılık; lock-in düşük (string değiştirilir).

#### Decision: RAG = enjekte edilen küratör bilgi (vektör DB yok, v1)
- **Context:** SPEC §3.7; Vethane bilgisi küçük + sabit (konumlandırma/FAQ/fiyat).
- **Choice:** `lib/ai/knowledge/*.md` küratör korpus; segmente göre ilgili parça prompt'a enjekte. pgvector = Future.
- **Rationale:** Küçük korpusta vektör arama gereksiz karmaşa; deterministik + ucuz.
- **Consequences:** Korpus büyürse pgvector'e geçiş (izole, `lib/ai`).

#### Decision: Sekanslama = cron + `next_action_at` (WDK değil)
- **Context:** SPEC §3.2.2; CONTEXT karar #11.
- **Choice:** Vercel Cron her saat `next_action_at <= now` işler; durum Postgres'te.
- **Rationale:** Şeffaf/debug edilebilir; bu hacimde fazlasıyla yeter.
- **Consequences:** WDK'nın otomatik retry/pause'u yok; retry'ı `lib/util/retry` + event log ile elde ederiz.

#### Decision: Inbound = Pub/Sub push + yedek polling
- **Context:** SPEC §3.4.1, §11.4.
- **Choice:** Gmail watch → Pub/Sub → `/api/webhooks/gmail`; ilk 2 hafta `/api/cron/poll-sent` güvenlik ağı.
- **Rationale:** Düşük gecikme + push kaçaklarına karşı dayanıklılık.

#### Decision: Onay yüzeyi = Gmail Taslakları; ayrı repo
- **Choice:** Taslak Gmail'de oluşturulur (CONTEXT #6); proje Vethane'den ayrı repo (`saas-seller`).
- **Rationale:** Sıfır panel (v1); farklı yaşam döngüsü.

### 1.3 Dependency Inventory
| Package | Purpose | License | Justification |
|---|---|---|---|
| next | Framework/route handlers | MIT | UI'a giden yol + Vercel |
| drizzle-orm + drizzle-kit | ORM + migration | Apache-2.0 | §1.2 |
| @neondatabase/serverless | PG driver | MIT | Serverless uçları |
| ai | AI SDK v6 | Apache-2.0 | Taslak/sınıflama |
| googleapis | Gmail + Pub/Sub | Apache-2.0 | Resmi istemci |
| grammy | Telegram | MIT | Bildirim |
| cheerio | HTML parse | MIT | Enrichment |
| papaparse | CSV | MIT | Import |
| zod | Şema doğrulama | MIT | Sınır doğrulama |
| vitest | Test | MIT | Hızlı TS test |

**Dependency felsefesi:** Küratör-minimal (<15 doğrudan bağımlılık); her biri net bir SPEC ihtiyacına bağlı.

## 2. Design Patterns

### 2.1 Adapter Pattern (dış servisler)
**Why:** SPEC §4.3 — Gmail/Telegram/AI/Places dış servisleri kendi arayüzümüzün arkasına alırız → test edilebilir + değiştirilebilir.
```ts
export interface EmailProvider {
  createDraft(threadId: string | null, to: string, subject: string, body: string): Promise<string>;
  send(draftId: string): Promise<string>;            // returns messageId
  listHistory(startHistoryId: string): Promise<InboundMessage[]>;
  addLabel(threadId: string, label: string): Promise<void>;
  watch(): Promise<{ historyId: string; expiration: number }>;
}
export class GmailAdapter implements EmailProvider { /* googleapis impl */ }
```

### 2.2 Strategy Pattern (segment playbook'ları)
**Why:** SPEC §3.2/§3.4 — solo/mid/hospital davranışı tamamen farklı. Segment → playbook seçimi.
```ts
export interface Playbook {
  segment: Segment;
  buildOutbound(lead: Lead, step: number, kb: Knowledge): DraftSpec;     // konu+gövde planı
  buildReply(lead: Lead, msg: InboundMessage, cls: Classification, kb: Knowledge): ReplyPlan;
}
export const playbookFor = (s: Segment): Playbook =>
  s === "solo" ? soloPlaybook : s === "mid" ? midPlaybook : hospitalPlaybook;
// soloPlaybook fiyatı pricing config'ten çeker; mid/hospital fiyat KOYMAZ → discovery pivot.
```

### 2.3 Pipeline / Chain of Responsibility (guardrail)
**Why:** SPEC §3.6.4 — giden her taslak, gönderimden önce sıralı doğrulayıcılardan geçer. AI'a güvenmeyiz.
```ts
export type Guardrail = (d: OutboundDraft, ctx: Ctx) => GuardResult; // {ok} | {ok:false, reason}
export const guardrails: Guardrail[] = [
  suppressionCheck,        // alıcı suppression'da mı?
  noPriceForBigSegment,    // mid/hospital'da para regex → reject
  noPromises,              // indirim/garanti kalıpları → reject
  requireOptOut,           // cold mail'de opt-out satırı yoksa → reject
];
export function runGuardrails(d: OutboundDraft, ctx: Ctx): GuardResult {
  for (const g of guardrails) { const r = g(d, ctx); if (!r.ok) return r; }
  return { ok: true };
}
```

### 2.4 State Machine (sekans durumu)
**Why:** SPEC §3.2.2 — sekansın kontrollü geçişleri (cevap/çıkış/bitti).
```ts
type SeqStatus = "active" | "paused" | "stopped_replied" | "stopped_optout" | "completed";
export function onReply(s: SequenceState): SequenceState { return { ...s, status: "stopped_replied" }; }
export function advance(s: SequenceState, cfg: SeqCfg): SequenceState {
  const next = s.current_step + 1;
  if (next > cfg.maxSteps) return { ...s, status: "completed", next_action_at: null };
  return { ...s, current_step: next, next_action_at: addDays(now(), cfg.gapDays), last_sent_at: now() };
}
```

### 2.5 Service Layer + Repository
**Why:** Orkestrasyon (AI+guardrail+provider+repo) iş mantığını route'lardan ayırır; repo Drizzle'ı domain'den izole eder (test).
```ts
class OutboundService {
  constructor(private leads: LeadRepo, private seq: SequenceRepo, private mail: EmailProvider, private ai: AiPort) {}
  async processDue(now: Date) {
    for (const lead of await this.leads.dueForSend(now, cfg.activeTiers)) {
      const plan = playbookFor(lead.segment).buildOutbound(lead, lead.step, kb);
      const draft = await this.ai.writeDraft(plan, lead);
      const g = runGuardrails(draft, { lead });
      if (!g.ok) { await events.log("guardrail_block", lead.id, g); continue; }
      const draftId = await this.mail.createDraft(lead.gmail_thread_id, lead.email, draft.subject, draft.body);
      // mode=manual → bekle (kullanıcı gönderir); mode=auto → this.mail.send(draftId)
    }
  }
}
```

### 2.6 Retry with Backoff (dış çağrılar)
**Why:** SPEC §4.3 — Gmail/AI/Telegram geçici hataları. WDK olmadığı için elde retry.
```ts
export async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries - 1) throw e; await sleep(2 ** i * 500 + Math.random() * 200); }
  }
}
```

## 3. Project Structure

### 3.1 Directory Layout
```
saas-seller/
├── app/
│   ├── api/
│   │   ├── cron/
│   │   │   ├── outbound/route.ts        # due-send → OutboundService.processDue
│   │   │   ├── watch-renew/route.ts     # Gmail watch yenile (7 gün)
│   │   │   └── poll-sent/route.ts       # yedek polling (ilk 2 hafta)
│   │   ├── webhooks/
│   │   │   ├── gmail/route.ts           # Pub/Sub push → InboundService.handle
│   │   │   └── telegram/route.ts        # (Faz 3) buton callback
│   │   └── health/route.ts              # sağlık kontrolü
├── lib/
│   ├── domain/                          # Lead, Segment, Tier, Classification, errors, DTO tipleri
│   ├── db/
│   │   ├── schema.ts                    # Drizzle: leads, sequence_state, messages, suppression, events
│   │   ├── client.ts                    # Neon + Drizzle
│   │   └── repositories/                # leadRepo, sequenceRepo, messageRepo, suppressionRepo, eventRepo
│   ├── adapters/
│   │   ├── gmail.ts                     # GmailAdapter (EmailProvider)
│   │   ├── telegram.ts                  # TelegramAdapter (notify)
│   │   ├── ai.ts                        # AiPort: writeDraft (Sonnet) + classify (Haiku)
│   │   └── places.ts                    # Google Places (sourcing)
│   ├── playbooks/                       # solo.ts, mid.ts, hospital.ts, index.ts (selector)
│   ├── guardrails/                      # suppressionCheck, noPriceForBigSegment, noPromises, requireOptOut, index.ts
│   ├── services/
│   │   ├── outbound.ts                  # OutboundService
│   │   ├── inbound.ts                   # InboundService (classify → route → reply/notify)
│   │   ├── sequence.ts                  # state machine helpers
│   │   ├── sourcing.ts                  # Places + sicil → aday lead
│   │   ├── enrichment.ts               # website crawl → email + confidence
│   │   └── notify.ts                    # hot-signal → Telegram
│   ├── ai/
│   │   ├── prompts.ts                   # prompt builder (config + KB enjekte)
│   │   └── knowledge/                   # *.md — Vethane konumlandırma/FAQ (RAG korpus)
│   ├── config/
│   │   ├── pricing.ts                   # solo fiyat tablosu (tek gerçek kaynak)
│   │   ├── modules.ts                   # modül açıklamaları
│   │   ├── playbooks.ts                 # segment scriptleri/kuralları
│   │   ├── warmup.ts                    # günlük limit/ramp
│   │   ├── notify.ts                    # hangi olay bildirir
│   │   └── runtime.ts                   # active_tiers, action-modes (manual|auto), seq gaps
│   └── util/                            # retry.ts, logger.ts (→events), email-parse.ts, segment.ts
├── scripts/                             # source-leads, enrich-leads, import-seed, setup-gmail-watch (tsx CLI)
├── drizzle/                             # migrations
├── docs/                                # SPEC/IMPL/TASKS/PROMPT + CONTEXT (kökte)
├── .env.example
├── drizzle.config.ts
├── vercel.json                          # cron tanımları
├── package.json
└── README.md
```

**Yapısal felsefe:** Katman-bazlı `lib/` çekirdeği, ince Next route handler'ları. Dış servisler `adapters/` (port), iş kuralları `services/`, domain saf. Config = versiyonlu tek gerçek kaynak (SPEC §3.7).

### 3.2 Module Breakdown (özet)
- **adapters** → dış dünya (Gmail/Telegram/AI/Places); domain'e tip döner, dışarı domain sızdırmaz.
- **playbooks** → segment davranışı (Strategy); config/playbooks + knowledge tüketir.
- **guardrails** → saf doğrulayıcılar; OutboundDraft alır, izin/ret döner.
- **services** → orkestrasyon; repo+adapter+playbook+guardrail birleştirir.
- **db/repositories** → Drizzle erişimi; servisler yalnız repo arayüzü görür.
- **scripts** → operatör işleri (sourcing/enrichment/seed/watch kurulum), cron'dan bağımsız.

### 3.3 Module Dependency Graph
```
route(cron/webhook) → services → playbooks → config + knowledge
                          │            
                          ├→ adapters(gmail/telegram/ai/places)
                          ├→ guardrails
                          └→ db/repositories → Neon
domain ← (tümü paylaşır)
```

## 4. Data Layer

### 4.1 Database Schema (Postgres / Drizzle üretir)
```sql
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
  kurum_adi TEXT NOT NULL,
  sehir TEXT,
  tur kurum_tur,
  vet_sayisi INT,
  segment segment NOT NULL DEFAULT 'unknown',
  tier INT NOT NULL DEFAULT 1,
  email CITEXT,
  email_confidence TEXT,                 -- 'high' | 'low'
  website TEXT,
  place_id TEXT UNIQUE,
  phone TEXT,
  instagram TEXT,
  karar_verici TEXT,
  kaynak TEXT,
  durum lead_durum NOT NULL DEFAULT 'aday',
  gmail_thread_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_leads_email ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX idx_leads_durum_tier ON leads(durum, tier);

CREATE TABLE sequence_state (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  current_step INT NOT NULL DEFAULT 0,
  next_action_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  status seq_status NOT NULL DEFAULT 'active'
);
CREATE INDEX idx_seq_due ON sequence_state(status, next_action_at);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direction msg_dir NOT NULL,
  gmail_message_id TEXT,
  subject TEXT,
  body TEXT,
  classification classification,         -- inbound
  status msg_status,                     -- outbound
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_lead ON messages(lead_id, created_at);

CREATE TABLE suppression (
  email CITEXT PRIMARY KEY,
  reason supp_reason NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_type ON events(type, created_at);
```
> `CITEXT` için `CREATE EXTENSION IF NOT EXISTS citext;`

### 4.2 Migration Strategy
`drizzle-kit generate` → SQL migration → `drizzle-kit migrate` (CI/prod) ; dev'de `push`. Migration dosyaları `drizzle/`.

### 4.3 Data Access Pattern
Drizzle, repo arkasında. Örnek:
```ts
export const leadRepo = {
  dueForSend: (now: Date, tiers: number[]) => db.select().from(leads)
    .innerJoin(sequenceState, eq(sequenceState.leadId, leads.id))
    .where(and(eq(sequenceState.status, "active"), lte(sequenceState.nextActionAt, now),
               inArray(leads.tier, tiers), isNotNull(leads.email))),
  byThread: (tid: string) => db.select().from(leads).where(eq(leads.gmailThreadId, tid)).limit(1),
};
```

## 5. API Implementation

### 5.1 Route Structure
| Method | Path | Handler | Auth | SPEC |
|---|---|---|---|---|
| POST | /api/cron/outbound | OutboundService.processDue | CRON_SECRET | §3.2 |
| POST | /api/cron/watch-renew | GmailAdapter.watch | CRON_SECRET | §3.4.1 |
| POST | /api/cron/poll-sent | InboundService.poll | CRON_SECRET | §11.4 |
| POST | /api/webhooks/gmail | InboundService.handle | Pub/Sub OIDC | §3.4 |
| POST | /api/webhooks/telegram | notify callbacks | secret token | §3.5 (Faz3) |
| GET | /api/health | health | — | §11.3 IMPL |

### 5.2 Webhook Contract (Pub/Sub)
Hızlı `200` döner; ağır iş arka planda (Vercel `waitUntil`).
```ts
// app/api/webhooks/gmail/route.ts
export async function POST(req: Request) {
  if (!verifyPubSubOIDC(req)) return new Response("forbidden", { status: 403 });
  const { message } = await req.json();                 // base64 data → {emailAddress, historyId}
  waitUntil(inboundService.handle(decode(message.data)));
  return new Response(null, { status: 204 });           // retry fırtınasını önle
}
```

### 5.3 Validation
Webhook payload + AI çıktısı zod ile doğrulanır. AI sınıflama `generateObject` + zod enum:
```ts
const ClassificationSchema = z.object({
  cls: z.enum(["fiyat","demo","ilgili","ilgisiz","oto_yanit","cikis"]),
  confidence: z.number().min(0).max(1),
  segmentGuess: z.enum(["solo","mid","hospital","unknown"]).optional(),
});
```

### 5.4 Auth Flow (Gmail OAuth Internal)
```
1. Bir kez: scripts/setup-gmail-watch → OAuth consent (Internal, localhost redirect) → refresh_token al
2. refresh_token şifreli sakla (env/DB); access_token gerektikçe yenilenir
3. Pub/Sub topic + push subscription → /api/webhooks/gmail (Google Cloud)
4. watch() çağrısı 7 günde bir cron ile yenilenir
```

## 6. Frontend Implementation
v1'de UI **yok** (SPEC §7). Yüzey = Gmail + Telegram. (UI = Future v1.1; eklenince `app/(dashboard)/` + Server Components + shadcn.)

## 7. Error Handling Strategy

### 7.1 Classification
| Kategori | Örnek | Aksiyon | Log | Kullanıcı |
|---|---|---|---|---|
| Geçici dış hata | Gmail 5xx/timeout | retry+backoff | Warn (event) | — |
| AI hata/şema | classify parse fail | retry; sonra kuyrukta beklet | Warn | — |
| Guardrail block | mid'de fiyat | taslağı reddet/yeniden üret | Info (`guardrail_block`) | — |
| Auth | refresh_token geçersiz | dur + Telegram uyarısı | Error | Telegram alarm |
| Kalıcı | bounce | suppression(bounce) | Info | — |
| İç | DB down | retry; başarısızsa 5xx | Error | — |

### 7.2 Propagation
Adapter hataları tiplenir → service yakalar → `events` + (kritikse) Telegram alarm. Webhook her zaman hızlı 2xx/204 (iş `waitUntil`'de).

## 8. Configuration

### 8.1 Sources
Hiyerarşi: kod-içi config (`lib/config/*`) varsayılan → env (secrets) → (sonra) UI override. İş kuralları repo'da versiyonlu.

### 8.2 Config Schema (env)
| Key | Type | Env Var | Description |
|---|---|---|---|
| DB | string | DATABASE_URL | Neon bağlantısı |
| AI | string | AI_GATEWAY_API_KEY | Vercel AI Gateway |
| Gmail | string | GOOGLE_CLIENT_ID/SECRET, GMAIL_REFRESH_TOKEN | OAuth Internal |
| Pub/Sub | string | PUBSUB_TOPIC, PUBSUB_AUDIENCE | Push doğrulama |
| Telegram | string | TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID | Bildirim |
| Places | string | GOOGLE_PLACES_API_KEY | Sourcing |
| Cron | string | CRON_SECRET | Cron uç nokta koruması |
| Sender | string | SENDER_NAME, SENDER_EMAIL (info@vethane.com) | Kimlik |

### 8.3 Runtime config (kod, tunable)
`runtime.ts`: `activeTiers=[1]`, `actionModes={solo_fiyat:'manual',takip:'manual',mid_cold:'manual',...}`, `seq={maxSteps:3,gapDays:4}`; `warmup.ts`: `dailyCap`, ramp; `notify.ts`: tetikleyen olaylar.

## 9. Testing Strategy

### 9.1 Pyramid
| Level | Tool | Scope | Target |
|---|---|---|---|
| Unit | Vitest | guardrails, sequence state machine, segment türetme, enrichment email-extract | %90+ bu mantıkta |
| Integration | Vitest + test DB + mock adapters | OutboundService.processDue, InboundService.handle (tüm sınıf yolları) | Tüm playbook dalları |
| Manuel | — | Gmail taslak görünümü + Telegram bildirim (gerçek hesap, sandbox lead) | Lansman öncesi |

### 9.2 Patterns
Factory fixtures (`makeLead({segment})`); adapter'lar arayüz olduğu için kolay mock; **guardrail testi kritik** (mid/hospital'da sayı sızıntısı = kırmızı çizgi).

### 9.3 CI
`Push/PR → ESLint → tsc → Vitest → build`. (Vercel preview deploy otomatik.)

## 10. Security Implementation
- **Secrets:** yalnız env; `.env` gitignore; prod = Vercel env. `.env.example` şablon.
- **OAuth:** Internal app, en-az scope (`gmail.modify` + readonly gerekiyorsa); refresh_token şifreli.
- **Endpoint koruma:** cron `Bearer CRON_SECRET`; Pub/Sub OIDC audience; Telegram secret token.
- **Input:** zod sınırda; CSV sanitize; AI çıktısı guardrail'siz gönderilmez.
- **KVKK:** suppression + hard-delete (SPEC §5.3, §8.3); yalnız kamuya açık iş adresleri.

## 11. Deployment
- **Build:** `next build`. **Runtime:** Vercel Fluid Compute (Node 24).
- **Cron (`vercel.json`):**
```json
{ "crons": [
  { "path": "/api/cron/outbound", "schedule": "0 * * * *" },
  { "path": "/api/cron/watch-renew", "schedule": "0 6 */6 * *" },
  { "path": "/api/cron/poll-sent", "schedule": "*/10 * * * *" }
]}
```
- **Health:** `/api/health` → DB ping + son cron zamanı.
- **Monitoring:** structured log → `events`; kritik hata → Telegram; (sonra) günlük özet.

## 12. Development Workflow

### 12.1 Local Setup
```bash
git init && pnpm install
cp .env.example .env            # değerleri doldur (Neon, Gmail, Telegram, Places, AI Gateway)
pnpm drizzle-kit migrate        # şema
pnpm tsx scripts/setup-gmail-watch.ts   # bir kez: OAuth + watch + Pub/Sub
pnpm dev                        # Next dev; webhook testi için Vercel preview/tünel
pnpm tsx scripts/import-seed.ts data/seed.csv   # ilk lead'ler
```

### 12.2 Code Standards
ESLint+Prettier; `pnpm lint`, `pnpm typecheck`; conventional commits.

### 12.3 Git Workflow
`main` korumalı; feature dalları → PR → CI yeşil → squash merge. Vercel: PR=preview, main=prod.
