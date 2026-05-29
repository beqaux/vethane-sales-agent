# Telegram Control Plane — Single-Shot Implementation Prompt

> Bu prompt, autonomous bir Claude Code oturumunun saas-seller monorepo'sunda ADR-0006'yı baştan sona implement etmesi için yazıldı. ADR = spec. Bu prompt = yürütme sözleşmesi.

---

## 0. Önce Oku (zorunlu — bağlam çerçevesi)

```
docs/adr/0006-telegram-cift-yon-dar-onay-yuzeyi.md   ← TAM SPEC (her §'a sonra döneceksin)
docs/telegram-control-plane/TASKS.md                  ← İş kırılımı (T1→T11 sırası)
CONTEXT.md (özellikle karar #4, #6, #7)               ← Mimari ilkeler
docs/adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md  ← Demo tanımı (#3 akışı buna bağlı)
lib/adapters/telegram.ts                              ← Mevcut tek-yön adapter (genişletilecek)
lib/services/inbound.ts                               ← Mevcut inbound (#3 + #5 trigger noktaları)
lib/services/outbound.ts                              ← Mevcut outbound (#1 trigger noktası)
lib/services/notify.ts                                ← Mevcut notify formatı (button + template eklenecek)
lib/config/runtime.ts                                 ← ACTION_MODES (flip edilecek)
lib/db/schema.ts                                      ← Mevcut Drizzle şema (pending_actions eklenir)
lib/domain/ports.ts                                   ← Port interface'leri
lib/wiring.ts                                         ← Adapter ↔ service wiring
```

Bu dosyaları okumadan kod yazma. Spec ile çelişen bir şey görürsen DUR, kullanıcıya sor.

---

## 1. Görev

ADR-0006'da kararlaştırılan **Telegram çift-yön dar onay yüzeyini** mevcut saas-seller projesine ekle. Üç button flow + auto/notify policy + edge cases. Detay: ADR-0006 §2.

Hedefler:
- **#3 demo_followup'ta saat onayı** — en yüksek kaldıraç, ilk milestone (T8)
- **#1 cold premium taslak onayı** (mid_cold/hospital_cold)
- **#5 belirsiz cevap (confidence<0.5) taslak onayı**
- ACTION_MODES revize: `mid_takip`, `hospital_takip` → auto
- Failure (guardrail block, error) → Telegram notify
- Auto-fire'lar sessiz (status quo + premium takip)

Yapma:
- Gmail-yerel ana yüzeyini değiştirme (CONTEXT karar #6 korunur)
- Google Calendar entegrasyonu (deferred — ADR-0006 §4)
- Sabit Meet link (reddedildi — ADR-0006 §5 Alt-5)
- ISO time parsing (reddedildi — ADR-0006 §2.4: literal echo)
- Snooze butonu (reddedildi — ADR-0006 §5 Alt-4)
- #2 (premium takip auto fire) için button (sadece auto + sessiz)

---

## 2. Yürütme Stratejisi

`docs/telegram-control-plane/TASKS.md` sırasında çalış: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11.

**Her task sonrası:**
```bash
pnpm typecheck && pnpm test
```
Geçmiyorsa düzelt. Geçmeden bir sonraki task'a geçme.

**Her milestone'da commit** (`<task-id>: <kısa açıklama>` formatında — repo'nun mevcut conventional commit stiline uy):
```
T1: pending_actions schema + migration + repo
T2: telegram adapter button + edit + answerCallback
...
```

Push etme — kullanıcı manuel push yapacak.

**Her checkpoint'te** (TASKS.md'deki 🔍 işaretli yerler) DURUMU özetle, sonra devam:
- T4 sonrası: infra hazır
- T8 sonrası: #3 canlı (ilk gerçek değer)
- T10 sonrası: #1 canlı
- T11 sonrası: full scope

---

## 3. Kritik Code Patterns (inline)

### 3.1 `pending_actions` Drizzle şeması

```ts
// lib/db/schema.ts içine ekle (mevcut tabloların altına)

import { PENDING_ACTION_KINDS, PENDING_ACTION_STATUSES } from "../domain/enums";

export const pendingActionKindEnum = pgEnum("pending_action_kind", PENDING_ACTION_KINDS);
export const pendingActionStatusEnum = pgEnum("pending_action_status", PENDING_ACTION_STATUSES);

export const pendingActions = pgTable(
  "pending_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: pendingActionKindEnum("kind").notNull(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    gmailDraftId: text("gmail_draft_id"),
    gmailThreadId: text("gmail_thread_id"),
    payload: jsonb("payload").notNull().default({}),
    status: pendingActionStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_pending_status_expires").on(t.status, t.expiresAt),
    index("idx_pending_lead").on(t.leadId),
  ],
);
```

```ts
// lib/domain/enums.ts içine ekle

export const PENDING_ACTION_KINDS = ["send_draft", "cancel_draft", "confirm_demo_time"] as const;
export type PendingActionKind = typeof PENDING_ACTION_KINDS[number];

export const PENDING_ACTION_STATUSES = ["pending", "resolved", "expired", "cancelled"] as const;
export type PendingActionStatus = typeof PENDING_ACTION_STATUSES[number];
```

### 3.2 `PendingActionRepo` port

```ts
// lib/domain/ports.ts içine ekle

export interface PendingAction {
  id: string;
  kind: PendingActionKind;
  leadId: string;
  gmailDraftId: string | null;
  gmailThreadId: string | null;
  payload: Record<string, unknown>;
  status: PendingActionStatus;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface PendingActionRepo {
  create(input: Omit<PendingAction, "id"|"createdAt"|"resolvedAt"|"status"> & { id?: string }): Promise<PendingAction>;
  byId(id: string): Promise<PendingAction | null>;
  byPrefix(prefix: string): Promise<PendingAction | null>;
  resolve(id: string, finalStatus: "resolved"|"cancelled"|"expired"): Promise<boolean>;
  updatePayload(id: string, patch: Record<string, unknown>): Promise<void>;
  expireDue(now: Date): Promise<number>;
}
```

**`resolve()` atomic CAS** — concurrent çağrıların yarışmaması için:

```ts
async function resolve(id, finalStatus) {
  const res = await db.update(pendingActions)
    .set({ status: finalStatus, resolvedAt: new Date() })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.status, "pending")))
    .returning({ id: pendingActions.id });
  return res.length === 1;
}
```

### 3.3 `callback_data` formatı

`act:<8-char-prefix>:<verb>` — toplam ≤22 byte (limit 64 byte).

Verb'ler:
- `send` — kind=`send_draft`; Gmail send + edit "✅ Gönderildi"
- `cancel` — kind=`send_draft`; Gmail deleteDraft + edit "❌ İptal"
- `confirm` — kind=`confirm_demo_time`; template echo email + edit "✅ Onaylandı"
- `open` — herhangi bir kind; pending resolve + edit "↗ Gmail'e"

Prefix'ten lookup:
```ts
async function byPrefix(prefix: string) {
  return db.select().from(pendingActions)
    .where(and(
      sql`${pendingActions.id}::text LIKE ${prefix + "%"}`,
      eq(pendingActions.status, "pending"),
    ))
    .limit(1)
    .then(r => r[0] ?? null);
}
```

Collision argument: UUID v4 → 32 hex char; 8-char prefix = 2^32 namespace. Aynı anda max 1000 pending varsayımında çarpışma <10^-6.

### 3.4 Webhook route

```ts
// app/api/webhooks/telegram/route.ts
import { NextRequest, NextResponse } from "next/server";
import { telegramCallbackService, eventRepo, pendingActionRepo, telegramAdapter } from "@/lib/wiring";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const update = await req.json();
  const cb = update.callback_query;
  if (!cb) return new NextResponse("ok"); // ignore message updates

  const fromId = String(cb.from?.id ?? "");
  if (fromId !== process.env.TELEGRAM_CHAT_ID) {
    await eventRepo.log("telegram_unauthorized_callback", null, { fromId, dataPreview: String(cb.data).slice(0, 20) });
    return new NextResponse("ok");
  }

  // Tüm hatalı durumlarda 200 dönüyoruz (Telegram 5xx'i retry eder; istemiyoruz).
  try {
    await telegramCallbackService.handle(cb);
  } catch (e) {
    await eventRepo.log("telegram_callback_error", null, { error: (e as Error).message });
    await telegramAdapter.answerCallback(cb.id, { text: "İç hata — log'a düştü", alert: true });
  }
  return new NextResponse("ok");
}
```

### 3.5 Callback service skeleton

```ts
// lib/services/telegram-callback.ts

export function createTelegramCallbackService(deps: {
  pendingActions: PendingActionRepo;
  leads: LeadRepo;
  supp: SuppressionRepo;
  msgs: MessageRepo;
  events: EventRepo;
  mail: EmailProvider;
  notify: NotifyPort;
}) {
  async function handle(cb: TelegramCallbackQuery): Promise<void> {
    const parts = String(cb.data ?? "").split(":");
    if (parts.length !== 3 || parts[0] !== "act") {
      await deps.notify.answerCallback(cb.id, { text: "Geçersiz aksiyon" });
      return;
    }
    const [, prefix, verb] = parts;
    const pending = await deps.pendingActions.byPrefix(prefix);
    if (!pending) {
      await deps.notify.answerCallback(cb.id, { text: "Bu işlem bulunamadı" });
      return;
    }

    // status edge cases
    if (pending.status !== "pending") {
      const toastMap = {
        resolved: `Zaten yapıldı (${pending.resolvedAt?.toISOString().slice(11, 16) ?? ""})`,
        cancelled: "Zaten iptal edilmiş",
        expired: "⏱ 7 günden eski",
      };
      await deps.notify.answerCallback(cb.id, { text: toastMap[pending.status] });
      return;
    }
    if (pending.expiresAt < new Date()) {
      await deps.pendingActions.resolve(pending.id, "expired");
      await deps.notify.answerCallback(cb.id, { text: "⏱ 7 günden eski" });
      return;
    }

    // verb dispatch
    if (verb === "open") return handleOpen(pending, cb);
    if (pending.kind === "send_draft" && verb === "send") return handleSend(pending, cb);
    if (pending.kind === "send_draft" && verb === "cancel") return handleCancel(pending, cb);
    if (pending.kind === "confirm_demo_time" && verb === "confirm") return handleConfirm(pending, cb);

    await deps.notify.answerCallback(cb.id, { text: "Bilinmeyen aksiyon" });
  }

  // ... handleSend, handleCancel, handleConfirm, handleOpen
  // (TASKS.md T8 + T10'da detaylı pseudocode)

  return { handle };
}
```

### 3.6 Confirmation template (#3)

```ts
// lib/services/notify.ts içine

function extractFirstName(lead: Lead, fromEmail?: string): string | null {
  if (lead.kararVerici) {
    const first = lead.kararVerici.trim().split(/\s+/)[0];
    if (first.length >= 2) return first;
  }
  // (opsiyonel) from local-part'tan ad çıkar (örn. "ahmet.yilmaz@..." → "Ahmet")
  return null;
}

export function renderConfirmTemplate(ad: string | null, raw: string, senderName: string): string {
  const selam = ad ? `Merhaba ${ad},` : "Merhaba,";
  return `${selam}

"${raw}" bende de uygun.
Görüşme linkini toplantıdan ~15 dk önce ileteceğim.

İyi çalışmalar,
${senderName}`;
}
```

### 3.7 Telegram mesaj formatları (3 button flow + failure)

```ts
function gmailThreadUrl(threadId: string | null): string | null {
  if (!threadId) return null;
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

// #1 cold premium taslak
function formatColdDraftApproval(opts: {
  lead: Lead; subject: string; body: string; currentStep: number;
}): string {
  return [
    "🆕 Premium cold taslak hazır",
    `Klinik: ${opts.lead.kurumAdi}${opts.lead.sehir ? " · " + opts.lead.sehir : ""} · Tier ${opts.lead.tier} · ${opts.lead.segment}`,
    `Adım: ${opts.currentStep}/3`,
    "",
    `Konu: ${opts.subject}`,
    "",
    truncate(opts.body, 3500),
  ].join("\n");
}

// #3 demo zaman onayı
function formatDemoTimeApproval(opts: {
  lead: Lead; fromEmail: string; rawTime: string; previewBody: string;
}): string {
  return [
    "📅 Demo saati önerdi",
    `Klinik: ${opts.lead.kurumAdi}${opts.lead.sehir ? " · " + opts.lead.sehir : ""}`,
    `Müşteri: ${opts.fromEmail}`,
    "",
    `Müşteri öneri: "${opts.rawTime}"`,
    "",
    "Bot şu cevabı atacak:",
    `"${opts.previewBody}"`,
  ].join("\n");
}

// #5 belirsiz cevap
function formatUncertainReplyApproval(opts: {
  lead: Lead; cls: { cls: string; confidence: number }; msgBody: string; draftBody: string;
}): string {
  return [
    "❓ Belirsiz cevap (AI tahmini taslak)",
    `Klinik: ${opts.lead.kurumAdi}${opts.lead.sehir ? " · " + opts.lead.sehir : ""}`,
    `AI: cls=${opts.cls.cls}, confidence=${opts.cls.confidence.toFixed(2)}`,
    "",
    "Müşteri mesajı:",
    truncate(opts.msgBody, 400),
    "",
    "AI'nın taslağı:",
    truncate(opts.draftBody, 3500),
  ].join("\n");
}

// Failure notify
function formatFailure(opts: {
  kind: "guardrail"|"error"; lead?: Lead; action?: string; reason: string;
}): string {
  const prefix = opts.kind === "guardrail" ? "🚫 Block" : "⚠️ Error";
  const lines = [
    prefix,
    opts.lead ? `Klinik: ${opts.lead.kurumAdi}${opts.lead.sehir ? " · " + opts.lead.sehir : ""}` : null,
    opts.action ? `Action: ${opts.action}` : null,
    `Sebep: ${opts.reason}`,
  ].filter(Boolean);
  return lines.join("\n");
}
```

### 3.8 `proposedTime` substring guardrail

```ts
// lib/adapters/ai.ts içinde Haiku call'dan sonra
function validateProposedTime(time: { raw: string } | undefined, body: string) {
  if (!time) return undefined;
  if (!body.includes(time.raw)) {
    // halüsinasyon — drop
    return { dropped: true, raw: time.raw };
  }
  return { dropped: false, raw: time.raw };
}

// classify() içinde:
const v = validateProposedTime(rawResult.proposedTime, msg.body);
if (v?.dropped) {
  await eventRepo.log("classify_propose_time_hallucination", null, { raw: v.raw });
}
const proposedTime = v && !v.dropped ? { raw: v.raw } : undefined;
```

---

## 4. Veri Modeli (mevcut + yeni)

Mevcut tablolar (değişmez): `leads`, `sequence_state`, `messages`, `suppression`, `events`.

**Yeni:** `pending_actions` (yukarıdaki §3.1 şema).

---

## 5. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✓ (var) | Mevcut grammy Api token |
| `TELEGRAM_CHAT_ID` | ✓ (var) | Kurucu'nun chat_id'si (numeric string) |
| **`TELEGRAM_WEBHOOK_SECRET`** | ✓ (yeni) | `setWebhook` secret_token; route'ta `x-telegram-bot-api-secret-token` header'ında verify |
| `CRON_SECRET` | ✓ (var olabilir) | Vercel cron auth (`/api/cron/expire-pending` için) |

---

## 6. Edge Cases (ADR-0006 §2.7 — handle hepsi)

| # | Senaryo | Davranış |
|---|---|---|
| **E1** | #1 tap'lemeden müşteri arada cevap verdi (`durum=cevap_geldi`) | Refuse send + pending.status='cancelled' + edit "⚠️ Müşteri arada cevap verdi — taslak iptal" |
| **E2** | Draft Gmail'de manuel silinmiş | Gmail API hata → edit "❌ Draft bulunamadı" + pending='cancelled' |
| **E3** | İki kez tap | Idempotent — `resolve()` CAS false → toast "Zaten yapıldı (HH:MM)" |
| **E4** | 7+ gün sonra tap | Lazy expire (resolve→'expired') + toast "⏱ 7 günden eski" |
| **E5** | Lead durum "kaybedildi"/"cikti" | Refuse + edit "ℹ️ Lead durumu değişmiş, gönderilmedi" |
| **E6** | Suppression meanwhile | Refuse + edit "ℹ️ Email suppression'da, gönderilmedi" |
| **E7** | Yetkisiz `from.id` | Silent 200 + event log `telegram_unauthorized_callback` |
| **E8** | Gmail send fail (network) | Retry adapter'da (3x); sonra edit "❌ Gönderim başarısız" + pending kalır pending (retry'lanabilir) |

---

## 7. Bildirim Politikası (ADR-0006 §2.3 / 8-A)

| Kanal | Davranış |
|---|---|
| Solo outbound auto-fires | **Sessiz** (status quo) |
| Premium outbound auto-fires (`mid_takip`/`hospital_takip`) | **Sessiz** (T5 sonrası) |
| Premium reply auto-fires (`mid_reply`/`hospital_reply`) | **Notify** (status quo) |
| Guardrail block | **Notify failure** (yeni — T5) |
| Inbound/outbound error | **Notify failure** (yeni — T5) |
| #1, #3, #5 button trigger | **Notify with buttons** |
| Button tap sonucu | Telegram **edit** (butonlar kaldırılır, status satırı eklenir) |

---

## 8. Setup Adımları (T3'ten sonra)

```bash
# 1. Secret üret
openssl rand -hex 32  # bunu TELEGRAM_WEBHOOK_SECRET olarak ekle

# 2. Vercel env ekle
vercel env add TELEGRAM_WEBHOOK_SECRET preview production

# 3. Drizzle migration
pnpm db:generate
pnpm db:migrate

# 4. Deploy
vercel --prod  # veya kullanıcı manuel
```

Production deploy sonrası Telegram'a webhook ayarla:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://vethane-sales-agent.vercel.app/api/webhooks/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d 'allowed_updates=["callback_query"]'
```

`allowed_updates=["callback_query"]` kritik — bot'a yazı yazılırsa ignore (bizim flow callback-only).

---

## 9. Test Stratejisi

### Unit tests (her task ile beraber)
- `pending-action.test.ts`: create / byId / byPrefix / resolve idempotency / expireDue
- `telegram.test.ts`: notify with buttons / edit / answerCallback (grammy mock)
- `telegram-webhook.test.ts`: secret mismatch / unauthorized / dispatch / status cases
- `telegram-callback.test.ts`: send / cancel / confirm / open verb dispatcher; E1-E8
- `classify.test.ts`: proposedTime extraction fixtures + substring guardrail
- `notify.test.ts`: 3 message format + failure format

### Integration test (manuel — son adımda)
1. **#3 flow:** test lead `durum=demo_istedi` → inbound POST gövdesinde "Salı 14:00 müsait" → Telegram'da 2 buton mesaj → ✅ Onayla tap → confirmation mail gitti (log'da) + Telegram mesaj edit edildi
2. **#1 flow:** test lead Tier1 mid → cron tetikle → draft yarat → Telegram'da 3 buton → ✅ Gönder tap → mail gitti
3. **#5 flow:** düşük confidence inbound fixture → 3 buton → ✅ Gönder tap → AI'nın taslağı gitti
4. **E1 testi:** #1 button hazır → manuel olarak müşteri cevabını simüle et (lead.durum='cevap_geldi') → ✅ Gönder tap → refuse + edit
5. **E7 testi:** webhook'a yetkisiz chat_id'den callback → 200 silent + event log var

---

## 10. Definition of Done

T11 tamamlandığında:

- [ ] ADR-0006 §6 doğrulama checklist tüm itemleri yeşil
- [ ] `pnpm typecheck` 0 hata
- [ ] `pnpm test` 0 fail
- [ ] `pnpm build` temiz
- [ ] Mevcut 5 ADR/dokümantasyon dosyası dokunulmadı (`docs/adr/0005-*`, `CONTEXT.md` haricindekiler)
- [ ] CONTEXT.md ve ADR-0006 zaten güncel (grilling oturumunda yazıldı)
- [ ] Manuel uçtan-uca test (§9) 5 senaryoda pass
- [ ] 11 task için 11 commit + linear history
- [ ] `vercel.json` cron entry eklendi
- [ ] `.env.example` (varsa) `TELEGRAM_WEBHOOK_SECRET` ile güncellendi

---

## 11. Yapma Listesi (anti-pattern uyarıları)

❌ **AI'ya tarih parse ettirme.** `proposedTime` sadece literal substring. ISO timestamp YOK, timezone YOK, "yarın hangi gün" hesaplaması YOK.

❌ **Sabit Meet link ekleme.** Template "link 15 dk önce ileteceğim" der. Link YOK.

❌ **Snooze butonu ekleme.** Reddedildi (ADR §5 Alt-4).

❌ **#1 ve #5'te 2 buton.** Üç buton: ✅ / ❌ / ✏️ Gmail.

❌ **#3'te 3 buton.** İki buton: ✅ / ✏️ Gmail.

❌ **CONTEXT karar #6'yı ters çevirme.** Gmail-yerel ana yüzey kalır. Telegram tamamlayıcı.

❌ **`NotifyPort.notify`'ı zorunlu opts'a geçirme.** Geriye uyumlu kalmalı (mevcut çağrılar opts'sız).

❌ **callback_data'ya UUID tam yazma.** 8-char prefix + verb yeter. UUID 36 char + verb 64-byte sınırına yaklaşır.

❌ **Solo'ya button trigger ekleme.** Sadece premium cold (#1) ve düşük confidence reply (#5) button alır. Solo cold auto + sessiz.

❌ **`durum=demo_istedi` state'ini değiştirme.** ADR-0005'te `demo_izledi` yeni state önerisi var ama bu kapsamda DEFERRED. Durum demo_istedi kalır.

❌ **Premium reply (#6) notify'ını kapatma.** Status quo — auto kalır + notify kalır.

❌ **`/api/webhooks/telegram` 5xx döndürme.** Telegram retry eder; bizim hata loglama'mızı çoğaltır. Hep 200, hatayı içerde log + answerCallback ile bildir.

❌ **mid_cold/hospital_cold'ı da auto'ya çekme.** Sadece takip auto. Cold manual + button.

---

## 12. Cancel / Onay Anları

Bu prompt autonomous çalışıyor, ama şu noktalarda DUR ve kullanıcıya sor:

1. **Spec çelişkisi:** ADR-0006 ve mevcut kod çelişiyorsa (örn. `lib/services/inbound.ts`'de `demo_followup` branch'i ADR §2.4'ten farklı davranıyorsa).
2. **Schema migration sorunu:** `pnpm db:generate` beklenmedik bir migration üretirse (örn. var olan tabloyu silen migration).
3. **Telegram API breaking change:** grammy library davranışı ADR §2.6'da varsayılan API ile çelişirse.
4. **Production env eksik:** `TELEGRAM_WEBHOOK_SECRET` ya da `TELEGRAM_CHAT_ID` mevcut env'lerde yoksa.
5. **T8 sonrası checkpoint:** İlk uçtan-uca akış canlı; kullanıcıdan manuel doğrulama iste, ardından devam.

---

## 13. Genel Notlar

- **Mevcut commit'ler** son birkaç gün prompt-hardening ve quote-strip üzerinde çalıştı. Tonal değişiklik yok — bu paket yapısal/altyapısal.
- **Repo'nun pattern'leri:** `lib/services/*.ts` services factory pattern; `lib/adapters/*.ts` adapter pattern; `lib/wiring.ts` DI root; `lib/domain/ports.ts` port interface'leri. Bu pattern'lere uy.
- **Test framework:** Vitest. Mevcut testler `tests/` altında. Adapter mock'ları için inline factory + override.
- **TypeScript:** `strict: true`. `any` yok, `unknown` ile dar et.
- **Async patterns:** retry adapter'da var (`lib/util/retry.ts`); Gmail send + telegram notify aynı pattern.
- **Event logging:** Hemen her major aksiyon `events.log()`'a düşer. Yeni event tipleri: `demo_time_pending`, `demo_time_confirmed`, `cold_draft_sent_via_telegram`, `cold_draft_cancelled_via_telegram`, `uncertain_reply_sent_via_telegram`, `uncertain_reply_cancelled_via_telegram`, `telegram_unauthorized_callback`, `telegram_callback_error`, `classify_propose_time_hallucination`, `pending_action_expired`.

---

## 14. Final Çıktı

Bittiğinde kullanıcıya **kısa bir özet** sun:

```
✅ Telegram Control Plane — implementation complete

Changes:
- 1 yeni tablo (pending_actions) + migration
- 1 yeni route (/api/webhooks/telegram)
- 1 yeni cron (/api/cron/expire-pending)
- 2 yeni service (pending-action, telegram-callback)
- Genişletilen adapter (telegram: buttons + edit + callback)
- Genişletilen services (notify, inbound, outbound)
- ACTION_MODES: mid_takip + hospital_takip → auto
- AI classify schema: proposedTime opsiyonel field

Commits: 11
Tests: <N> yeni, hepsi pass
Type/lint: clean

Sıradaki adım (manuel, kullanıcı yapacak):
1. TELEGRAM_WEBHOOK_SECRET üret + Vercel env'e ekle
2. Production deploy
3. setWebhook (komut §8'de)
4. Test #3 fixture ile end-to-end
```

İyi yolculuklar.
