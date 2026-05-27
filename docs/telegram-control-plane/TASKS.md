# Telegram Control Plane — Tasks

> ADR-0006 implementation paketi.
> **Spec:** `docs/adr/0006-telegram-cift-yon-dar-onay-yuzeyi.md`. Bu dosya iş kırılımıdır, spec değildir.
> Sırayla çalıştırılır; her task tek Claude Code oturumunda biter. Her task sonrası `pnpm typecheck && pnpm test`.

## Summary

| Metric | Value |
|---|---|
| Toplam task | 11 |
| Faz | 4 (P0 Infra, P1 Quick Wins, P2 Demo Time, P3 Cold Premium, P4 Belirsiz Cevap) |
| Tahmini efor | ~3-4 dev günü |
| Foundation complete | T4 sonrası |
| First user value | **T8 sonrası** (#3 demo time button canlı — en yüksek kaldıraçlı akış) |
| Full scope | T11 sonrası |

## Referanslar

- **Spec:** `docs/adr/0006-telegram-cift-yon-dar-onay-yuzeyi.md` (her task'a girmeden önce ilgili §'ı oku)
- **Bağlamsal:** `CONTEXT.md` karar #4 (gradyan auto), #6 (Gmail-yerel), #7 (Telegram çift-yön)
- **Önceki:** `docs/adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md`
- **Mevcut Telegram adapter:** `lib/adapters/telegram.ts` (tek-yön, genişletilecek)
- **Mevcut notify service:** `lib/services/notify.ts` (mesaj template'ları + button helper'ları eklenecek)

---

## P0 — Infrastructure (Foundation)

> Tüm button flow'larının ön koşulu. P0 bitmeden P2-P4 başlamaz. P1 paralel.

### T1: pending_actions schema + Drizzle migration + repo port

**pending_actions tablosu + repo abstraction + idempotent resolve.**

**Files:**
- `lib/domain/enums.ts` — `PENDING_ACTION_KINDS`, `PENDING_ACTION_STATUSES` enum array'leri
- `lib/db/schema.ts` — `pendingActionKindEnum`, `pendingActionStatusEnum`, `pendingActions` tablosu
- `lib/domain/ports.ts` — `PendingActionRepo` interface
- `lib/db/repo-postgres.ts` (veya adapter neredeyse) — Drizzle impl
- `lib/wiring.ts` — repo wiring
- `drizzle/<timestamp>_pending_actions.sql` — migration (drizzle-kit generate ile)
- `tests/db/pending-action.test.ts` — unit test

**Implementation:**
1. Enums: `kind ∈ {send_draft, cancel_draft, confirm_demo_time}`, `status ∈ {pending, resolved, expired, cancelled}`.
2. Tablo şeması ADR-0006 §2.5'ten birebir.
3. Repo interface:
   ```ts
   interface PendingActionRepo {
     create(input: Omit<PendingAction, "id"|"createdAt"|"resolvedAt"|"status">): Promise<PendingAction>;
     byId(id: string): Promise<PendingAction | null>;
     byPrefix(prefix: string): Promise<PendingAction | null>; // 8-char id prefix → ilk pending match
     resolve(id: string, finalStatus: "resolved"|"cancelled"|"expired"): Promise<boolean>; // atomic CAS, false = already non-pending
     expireDue(now: Date): Promise<number>; // expires_at < now AND status='pending' → 'expired'
   }
   ```
4. `byPrefix`: index on `id`, query `WHERE id::text LIKE prefix || '%' AND status='pending' LIMIT 1` (8 char = 2^32 namespace, collision pratik olarak yok).
5. `resolve`: atomic update `WHERE id=? AND status='pending'` — RETURNING affected count; concurrent çağrılarda yarış kazananı bir tane.

**Acceptance Criteria:**
- [ ] `pnpm db:generate` migration üretiyor
- [ ] `pnpm db:migrate` migration uygulanıyor
- [ ] Repo `create → byId → resolve → resolve(2.kez)` idempotent (2. resolve `false` döner)
- [ ] `byPrefix` 8-char prefix ile doğru pending'i buluyor
- [ ] `expireDue` >TTL pending'leri 'expired'a alıyor, resolved'lara dokunmuyor
- [ ] `pnpm typecheck && pnpm test` pass

**Dependencies:** None
**Effort:** 3-4 saat
**Refs:** ADR-0006 §2.5

---

### T2: Telegram adapter — buttons + edit + answerCallback

**`NotifyPort` çift-yön; adapter inline keyboard + message edit + callback ack.**

**Files:**
- `lib/domain/ports.ts` — `NotifyPort` genişler
- `lib/adapters/telegram.ts` — yeni metotlar
- `tests/adapters/telegram.test.ts` — yeni testler (grammy mock)

**Implementation:**
1. `NotifyPort` interface güncellemesi (geriye uyumlu):
   ```ts
   type TelegramButton =
     | { text: string; callback_data: string }
     | { text: string; url: string };
   type ButtonRow = TelegramButton[];

   interface NotifyPort {
     notify(text: string, opts?: { buttons?: ButtonRow[] }): Promise<{ messageId: number; chatId: string }>;
     edit(chatId: string, messageId: number, text: string, opts?: { buttons?: ButtonRow[] }): Promise<void>;
     answerCallback(callbackQueryId: string, opts?: { text?: string; alert?: boolean }): Promise<void>;
   }
   ```
2. Mevcut `notify(text)` çağrıları opts'u boş geçer, davranış değişmez.
3. Adapter `notify()` dönüşünde grammy `sendMessage` response'tan `message_id` döndürür.
4. `edit()` `editMessageText` çağırır; opts.buttons varsa `reply_markup: { inline_keyboard }` ekler.

**Acceptance Criteria:**
- [ ] `notify(text)` (opts'sız) eskisi gibi davranır + `{ messageId, chatId }` döner
- [ ] `notify(text, { buttons })` inline keyboard ile mesaj atar
- [ ] `edit()` mesaj metnini ve butonlarını günceller
- [ ] `answerCallback()` çağrısı grammy `answerCallbackQuery`'e map'lenir
- [ ] Existing `notify.ts` çağrıları kırılmaz (smoke test mevcut `hot()` çağrıları)

**Dependencies:** None (T1'den bağımsız)
**Effort:** 2-3 saat
**Refs:** ADR-0006 §2.6

---

### T3: Webhook route + secret + chat_id authz + callback skeleton

**`POST /api/webhooks/telegram` — secret header + chat_id allowlist + callback parse + dispatch iskeleti.**

**Files:**
- `app/api/webhooks/telegram/route.ts` (yeni)
- `lib/services/telegram-callback.ts` (yeni, dispatch iskeleti — verb handler'lar T8/T10)
- `tests/api/telegram-webhook.test.ts` (yeni)

**Implementation:**
1. Route handler:
   - `x-telegram-bot-api-secret-token` header `process.env.TELEGRAM_WEBHOOK_SECRET`'a eşit değilse 401
   - Body `Update` JSON; `callback_query` yoksa 200 silent
   - `callback_query.from.id` (numeric) `String(...)` ile env `TELEGRAM_CHAT_ID`'ye eşit değilse → 200 + event log `telegram_unauthorized_callback`
   - `callback_query.data` parse: `act:<8-char prefix>:<verb>`
   - `pendingActionRepo.byPrefix(prefix)` → null ise `answerCallback("Bu işlem bulunamadı")`
   - `pending.status !== 'pending'` ise toast (`resolved` → "Zaten yapıldı (HH:MM)"; `expired` → "⏱ 7 günden eski"; `cancelled` → "İptal edilmiş")
   - `pending.expiresAt < new Date()` ise lazy-expire (resolve('expired')) + toast
   - Dispatch: `callbackService.dispatch(pending, verb, cb)` — verb handler'ları henüz placeholder (`open` hariç)
2. `open` verb genel handler (T8/T10'da reuse): pending'i 'resolved' yap + telegram edit "↗ Gmail'e yönlendirildi" + answerCallback toast
3. Telegram retry'larına dayanıklı: tüm hatalı durumlarda 200 dön (5xx Telegram'ı tekrar denemeye iter).
4. `lib/wiring.ts`'de callbackService inject.

**Acceptance Criteria:**
- [ ] POST yanlış secret → 401
- [ ] POST `callback_query` yok → 200 silent (mesaj update'leri ignore)
- [ ] POST yetkisiz chat_id → 200 + event log
- [ ] POST geçerli callback + pending → dispatch çağrılır; status pending değil → toast
- [ ] POST expired pending → lazy-expire + toast
- [ ] Tests: secret mismatch, unauthorized, dispatch, status edge cases

**Dependencies:** T1, T2
**Effort:** 3-4 saat
**Refs:** ADR-0006 §2.6, §2.7 (E3, E4, E7)

---

### T4: pending-action service + TTL cron

**Domain service: create token + resolve + scheduled expiry job.**

**Files:**
- `lib/services/pending-action.ts` (yeni)
- `app/api/cron/expire-pending/route.ts` (yeni Vercel cron)
- `vercel.json` — yeni cron entry (`/api/cron/expire-pending` daily)
- `tests/services/pending-action.test.ts` (yeni)

**Implementation:**
1. Service:
   ```ts
   createPendingAction(opts: {
     kind: PendingActionKind;
     leadId: string;
     gmailDraftId?: string;
     gmailThreadId?: string;
     payload?: Record<string, unknown>;
     ttlDays?: number;  // default 7
   }): Promise<{ pending: PendingAction; tokenPrefix: string }>;

   resolvePendingAction(id: string, status: "resolved"|"cancelled"|"expired"): Promise<boolean>;
   ```
2. `tokenPrefix` = `pending.id.slice(0, 8)` (UUID v4 hex prefix; collision practical olarak yok).
3. Cron route: vercel cron header auth → `pendingActionRepo.expireDue(now)` → count döner.
4. `vercel.json` cron entry:
   ```json
   { "crons": [{ "path": "/api/cron/expire-pending", "schedule": "0 3 * * *" }] }
   ```

**Acceptance Criteria:**
- [ ] `createPendingAction` 7gün ttl + tokenPrefix döner
- [ ] tokenPrefix prefix UUID'nin ilk 8 char'ı
- [ ] Token + verb birleşimi callback_data 64-byte sınırına bol marj (`act:` + 8 + `:` + ≤8 verb ≤ 22 byte)
- [ ] `resolvePendingAction` 2. kez çağrı `false` döner (idempotent)
- [ ] Cron route DRY count döner; sadece pending status'tekileri expire eder
- [ ] Cron route vercel cron auth header verify

**Dependencies:** T1
**Effort:** 2-3 saat
**Refs:** ADR-0006 §2.5, §2.7 (E4)

---

🔍 **Checkpoint T4:** P0 infra bitti. `pnpm typecheck && pnpm test && pnpm build` temiz. Henüz hiçbir akış canlı değil; webhook test message ile manuel ping atılabilir.

---

## P1 — Quick Wins (P0'a paralel)

### T5: ACTION_MODES flip + failure notify + auto-fire silence

**Premium takip auto'ya alınır; guardrail block ve error → Telegram notify; auto-fire'lar sessiz kalır.**

**Files:**
- `lib/config/runtime.ts` — `mid_takip`, `hospital_takip` → `"auto"`
- `lib/services/notify.ts` — `failure()` metodu eklenir
- `lib/services/outbound.ts` — guardrail block'ta `notify.failure(...)` çağrısı
- `lib/services/inbound.ts` — try/catch'lerde `notify.failure(...)` çağrısı
- `tests/config/action-modes.test.ts` (yeni)
- `tests/services/notify.test.ts` — failure format test

**Implementation:**
1. `ACTION_MODES` revize:
   ```ts
   mid_takip: "auto",       // önce "manual"
   hospital_takip: "auto",  // önce "manual"
   ```
   Diğer satırlar değişmez. `mid_cold`, `hospital_cold` MANUAL kalır.
2. `NotifyService.failure(opts: { kind: "guardrail"|"error"; lead?: Lead; action?: ActionType; reason: string; threadLink?: string })`:
   - Mesaj formatı ADR-0006 §1 "Failure notify" bloğundan
   - 🚫 (guardrail) veya ⚠️ (error) prefix; "✏️ Gmail" url buton (threadLink varsa)
3. `outbound.ts` g.ok=false dalında events.log YANINA `notify.failure({ kind: "guardrail", lead, action, reason, ...})`
4. `inbound.ts` handle()'in catch bloğunda `notify.failure({ kind: "error", lead?, reason: err.message })`
5. Auto-fire'lar (mid_takip/hospital_takip ve solo'lar) ÇIKARDA notify çağrısı YOKTUR — mevcut kod zaten böyle, doğrulayın.

**Acceptance Criteria:**
- [ ] `runtime.ts` mid_takip/hospital_takip 'auto', mid_cold/hospital_cold 'manual'
- [ ] Auto outbound (solo veya premium takip) Telegram'a ping atmaz (status quo doğrulama)
- [ ] Guardrail block tetiklendiğinde Telegram'a 🚫 mesaj
- [ ] Inbound error'unda ⚠️ mesaj
- [ ] Premium reply (#6) notify'ı bozulmadı (status quo)
- [ ] `pnpm typecheck && pnpm test` pass

**Dependencies:** T2
**Effort:** 1-2 saat
**Refs:** ADR-0006 §2.2, §2.3

---

## P2 — Demo Time Onayı (en yüksek kaldıraç)

> ADR-0006'nın asıl tetikleyicisi. P0 bitti varsayımıyla başlar.

### T6: AI classify schema — proposedTime extraction + substring guardrail

**Haiku classify çıktısına `proposedTime` opsiyonel field; prompt literal substring çıkarsın; halüsinasyon kod-seviyesi guardrail ile drop.**

**Files:**
- `lib/domain/schemas.ts` — `ClassificationResult` tipini içeren yer; `proposedTime?: { raw: string }` eklenir
- `lib/domain/ports.ts` — `AiPort.classify()` return tipi yansıtır
- `lib/adapters/ai.ts` — Haiku prompt + zod schema + post-processing guardrail
- `tests/ai/classify.test.ts` — yeni fixture'lar

**Implementation:**
1. Schema:
   ```ts
   const classificationSchema = z.object({
     cls: classificationEnum,
     confidence: z.number().min(0).max(1),
     segmentGuess: segmentEnum.optional(),
     vetCountGuess: z.number().optional(),
     proposedTime: z.object({ raw: z.string().min(1).max(80) }).optional(),
   });
   ```
2. Haiku prompt'una eklenir (Türkçe):
   ```
   Eğer mesaj GELECEK bir tarih için spesifik bir gün+saat önerisi içeriyorsa
   (örn. "Salı 14:00 müsait", "yarın 10'da", "27 Mayıs Çarşamba 14:00"), proposedTime.raw
   alanına müşterinin tam o ifadesini (substring olarak) yaz. Gün VEYA saat yoksa,
   ya da geçmiş tarih ise, alanı boş bırak. UYDURMA — sadece mesajda LİTERAL geçen
   ifadeyi yaz.
   ```
3. Post-processing guardrail (adapter'da):
   ```ts
   if (result.proposedTime && !msg.body.includes(result.proposedTime.raw)) {
     await eventRepo.log("classify_propose_time_hallucination", null, { raw: result.proposedTime.raw });
     result.proposedTime = undefined;
   }
   ```

**Acceptance Criteria:**
- [ ] Fixture: "Salı 14:00 müsait" → `proposedTime.raw` "Salı 14:00" içerir + substring kontrol pass
- [ ] Fixture: "Merhaba, teşekkürler" → `proposedTime` undefined
- [ ] Fixture: "Önümüzdeki hafta Çarşamba veya Perşembe" → AI'dan ya undefined ya da literal substring; her durumda guardrail substring olmayanı drop eder
- [ ] Fixture: AI uydurma (proposedTime.raw mesajda yok) → drop + event log
- [ ] Backwards compat: eski classify çağrı yerleri kırılmaz (alan opsiyonel)

**Dependencies:** T1 (events repo); pratik olarak başlangıçta bağımsız da çalışabilir
**Effort:** 2-3 saat
**Refs:** ADR-0006 §2.4

---

### T7: Inbound #3 trigger — demo_followup'ta saat → pending_action + notify

**`durum=demo_istedi` + `proposedTime` varsa pending_action yarat + Telegram 2-buton mesajı; yoksa bugünkü info notify.**

**Files:**
- `lib/services/inbound.ts` — mevcut `lead.durum === "demo_istedi"` branch'i genişler (line ~152)
- `lib/services/notify.ts` — `demoTimeApproval()` helper / message template
- `lib/playbooks/index.ts` — demo_followup plan return değerine `proposedTimeRaw` eklenir (opsiyonel; tek başına refactor edilebilir)
- `lib/config/runtime.ts` — `BRAND.demoConfirmTemplate` ekle (T8'de kullanılacak ama burada def edelim)
- `tests/services/inbound.test.ts` — yeni test

**Implementation:**
1. `inbound.ts`'de mevcut `demo_followup` branch yapısı:
   ```ts
   if (lead.durum === "demo_istedi") {
     if (cls.proposedTime) {
       const { pending, tokenPrefix } = await deps.pendingActions.createPendingAction({
         kind: "confirm_demo_time",
         leadId: lead.id,
         gmailThreadId: msg.threadId,
         payload: {
           proposedTimeRaw: cls.proposedTime.raw,
           fromEmail: msg.fromEmail,
           headerMessageId: msg.headerMessageId,
           subject: msg.subject,
         },
       });
       const preview = renderConfirmTemplate(lead, cls.proposedTime.raw);
       await deps.notify.demoTimeApproval({ lead, msg, raw: cls.proposedTime.raw, preview, tokenPrefix });
       // mevcut info notify atlanır — pending_action yarattığımız için
     } else {
       // mevcut "💬 Demo sonrası mesaj" info notify
       await deps.notify.hot("💬 Demo sonrası mesaj — kurucu takip etsin", lead, msg, { cls });
     }
     // bot yine sussun (sendDraft=false), durum demo_istedi
     await deps.events.log("inbound_handled", lead.id, { ... });
     return;
   }
   ```
2. `notify.demoTimeApproval()`:
   - Mesaj formatı ADR-0006 §1 "#3 demo zaman onayı" bloğundan
   - Buttons: `[[{text:"✅ Onayla", callback_data:`act:${tokenPrefix}:confirm`}, {text:"✏️ Gmail", url: gmailThreadUrl(threadId)}]]`
3. `gmailThreadUrl(id)` helper: `https://mail.google.com/mail/u/0/#all/${id}`.
4. `renderConfirmTemplate` helper T8'de tam yazılacak — burada stub (literal echo yap).

**Acceptance Criteria:**
- [ ] durum=demo_istedi + proposedTime VAR → pending_action 'confirm_demo_time' yaratıldı
- [ ] Telegram'a 2-buton mesaj (✅ Onayla + ✏️ Gmail) gitti
- [ ] durum=demo_istedi + proposedTime YOK → eski info notify ("💬 Demo sonrası") gitti
- [ ] Bot taslak yazmadı (sendDraft hala false)
- [ ] events.log entry'leri doğru (`inbound_handled` + opsiyonel `demo_time_pending`)

**Dependencies:** T1, T2, T3, T4, T6
**Effort:** 3-4 saat
**Refs:** ADR-0006 §2.1 (akış #3), §1 (mesaj formatı), §2.4 (template)

---

### T8: Callback handler — confirm_demo_time (`confirm` + `open`)

**Tap'lendiğinde template confirmation mailini Gmail API ile gönder + Telegram message edit + idempotent + edge cases.**

**Files:**
- `lib/services/telegram-callback.ts` — verb dispatcher genişler
- `lib/services/notify.ts` — `renderConfirmTemplate(lead, raw)` final hâli + `gmailThreadUrl(id)` helper
- `lib/util/email-parse.ts` — `extractFirstName(lead, fromEmail?)` helper (lead.kararVerici → from local-part → null)
- `lib/config/runtime.ts` — `BRAND.demoConfirmTemplate` final
- `tests/services/telegram-callback.test.ts` — verb=confirm fixtures

**Implementation:**
1. `confirm` verb (kind='confirm_demo_time') flow:
   ```
   a) pendingActionRepo.resolve(id, 'resolved') → false ise (zaten resolved) → answerCallback "Zaten yapıldı"; return
   b) lead = leadRepo.byId(pending.leadId); durum guard (E5: 'kaybedildi'|'cikti' → refuse + edit "ℹ️ Lead durumu değişmiş")
   c) suppression check (E6: suppRepo.has(payload.fromEmail) → refuse + edit "ℹ️ Suppression")
   d) ad = extractFirstName(lead, payload.fromEmail)
   e) body = renderConfirmTemplate(ad, payload.proposedTimeRaw)
   f) replySubject = /^re:\s/i.test(payload.subject) ? payload.subject : `Re: ${payload.subject}`
   g) created = mail.createDraft(payload.threadId, payload.fromEmail, replySubject, body, payload.headerMessageId)
   h) await mail.send(created.id) — retry 3x (E8 — adapter'da retry mevcut)
   i) messages.add({ direction:'out', subject, body, status:'sent', ... })
   j) telegramAdapter.edit(chatId, originalMessageId, statusText, { buttons: [] })
      — statusText: "✅ Onaylandı <HH:MM> — confirmation maili gönderildi"
   k) answerCallback("Gönderildi")
   l) events.log('demo_time_confirmed', lead.id, { raw, draftId: created.id })
   ```
2. `open` verb (kind='confirm_demo_time' AND verb='open'): pending'i 'resolved' yap, mail GÖNDERME, edit "↗ Gmail'e yönlendirildi", answerCallback toast.
3. Template:
   ```ts
   function renderConfirmTemplate(ad: string | null, raw: string): string {
     const selam = ad ? `Merhaba ${ad},` : "Merhaba,";
     return `${selam}

   "${raw}" bende de uygun.
   Görüşme linkini toplantıdan ~15 dk önce ileteceğim.

   İyi çalışmalar,
   ${BRAND.senderName}`;
   }
   ```
4. Telegram mesaj edit'i için chatId + messageId pending_action.payload'da tutulmalı (T7 createPendingAction çağrısında ekle: `payload.telegram = { chatId, messageId }` — T2'den dönen ile).

**Acceptance Criteria:**
- [ ] confirm verb tap → mail gönderildi (mail.send çağrıldı, messages.add 'sent')
- [ ] Telegram mesajı edit edildi (buttons kaldırıldı, status satırı eklendi)
- [ ] İkinci tap → resolve false → toast "Zaten yapıldı"
- [ ] E5 (durum değişmiş) → refuse + edit "ℹ️ Lead durumu değişmiş"; mail GÖNDERME
- [ ] E6 (suppression) → refuse + edit
- [ ] open verb tap → pending resolved, mail GÖNDERME, edit "↗ Gmail'e"
- [ ] Test fixtures: happy path, double-tap, E5, E6, open

**Dependencies:** T7
**Effort:** 3-4 saat
**Refs:** ADR-0006 §2.4, §2.7 (E1-E8)

---

🔍 **Checkpoint T8:** #3 akışı uçtan-uca canlı. Manuel test: lead durum=demo_istedi fixture'ı yarat → inbound POST "Salı 14:00 müsait" → Telegram bildirim + 2 buton → ✅ Onayla tap → confirmation mail gitti + Telegram edit. **İlk gerçek kullanıcı değeri.**

---

## P3 — Cold Premium Taslak Button

### T9: Outbound #1 trigger — cold premium taslakta pending_action + notify

**`mid_cold`/`hospital_cold` cron taslak yarattığında pending_action + 3-buton Telegram notify; auto'ya hiç dokunma.**

**Files:**
- `lib/services/outbound.ts` — manual mode'da pending_action create + notify
- `lib/services/notify.ts` — `coldDraftApproval()` helper / message template
- `tests/services/outbound.test.ts` — yeni test

**Implementation:**
1. `outbound.ts`'de auto check'ten sonra (`const auto = ...`):
   ```ts
   const created = await deps.mail.createDraft(...);
   // ... mevcut etiket vs kalır

   if (auto) {
     await deps.mail.send(created.id);
   } else if (spec.action === "mid_cold" || spec.action === "hospital_cold") {
     // #1: pending_action + telegram button notify
     const { tokenPrefix, telegramMessage } = await deps.notify.coldDraftApproval({
       lead, draftId: created.id, threadId: created.threadId, action: spec.action,
       subject: draft.subject, body: draft.body, currentStep: lead.seq.currentStep,
     });
     await deps.pendingActions.createPendingAction({
       kind: "send_draft",
       leadId: lead.id,
       gmailDraftId: created.id,
       gmailThreadId: created.threadId,
       payload: {
         action: spec.action,
         telegram: { chatId: telegramMessage.chatId, messageId: telegramMessage.messageId },
         tokenPrefix,
       },
     });
     // NOT: pending_action önce yaratılır → tokenPrefix bilinir → notify atılır. Yukarı sıralama düzeltilmeli.
   }
   ```
   **Doğru sıralama:** önce `createPendingAction` (id bilinir → prefix) → sonra `notify.coldDraftApproval` (tokenPrefix ile button data inşa et) → notify dönüşünden `{chatId, messageId}` al → pending_action payload'una upsert (`updatePayload`). Veya: pending'i önce create et, notify dönüşünden messageId'yi event'a yaz, edit yaparken pending.payload yerine messages tablosundan oku. **En temizi:** notify atılır → messageId döner → pending create edilir (id sonradan generate olur ama tokenPrefix henüz yok). Çözüm: id'yi pre-generate et (uuid client-side), token'ı çıkar, button'ları kur, notify at, pending insert et (id ile birlikte).
2. `coldDraftApproval()` mesajı ADR-0006 §1 cold premium tablosundan:
   - Body 3500 char truncate
   - Buttons: `✅ Gönder` (callback `act:<prefix>:send`), `❌ İptal` (`act:<prefix>:cancel`), `✏️ Gmail` (url)

**Acceptance Criteria:**
- [ ] mid_cold cron taslak yaratıldı → pending_action 'send_draft' + Telegram 3-buton mesaj
- [ ] hospital_cold için aynı
- [ ] Solo cold için notify çağrısı YOK (status quo)
- [ ] mid_takip (auto) için notify çağrısı YOK (T5 sonrası)
- [ ] Test: outbound.processDue mid_cold fixture → pending_action assert + notify mock assert

**Dependencies:** T1, T2, T3, T4, T5
**Effort:** 2-3 saat
**Refs:** ADR-0006 §2.1 (akış #1), §1 (mesaj formatı)

---

### T10: Callback handler — send_draft (`send` + `cancel` + `open`)

**`✅ Gönder` tap'inde Gmail draft send; `❌ İptal`'de draft delete; edge case'ler E1, E2, E5, E6.**

**Files:**
- `lib/services/telegram-callback.ts` — `send_draft` kind dispatcher
- `lib/adapters/gmail.ts` — `deleteDraft(id)` metodu (mevcut değilse ekle)
- `lib/adapters/gmail.ts` — `getDraft(id)` metodu (mevcut değilse ekle, E2 için)
- `tests/services/telegram-callback.test.ts` — send/cancel fixtures

**Implementation:**
1. `send` verb (kind='send_draft'):
   ```
   a) lead = leadRepo.byId(pending.leadId)
   b) E5 guard: durum ∈ {'kaybedildi','cikti'} → refuse + edit + pending.status='cancelled'
   c) E1 guard: durum === 'cevap_geldi' → refuse + edit "⚠️ Müşteri arada cevap verdi — taslak iptal" + pending.status='cancelled'
   d) E6 guard: suppRepo.has(lead.email) → refuse + edit "ℹ️ Suppression"
   e) E2 guard: try mail.getDraft(pending.gmailDraftId); catch → refuse + edit "❌ Draft bulunamadı"
   f) resolve(id, 'resolved') (CAS)
   g) await mail.send(pending.gmailDraftId) — retry adapter'da
   h) messages.add ya da update: outbound record status 'draft' → 'sent'
   i) edit "✅ Gönderildi <HH:MM>"
   j) answerCallback "Gönderildi"
   k) events.log('cold_draft_sent_via_telegram', lead.id, ...)
   ```
2. `cancel` verb:
   ```
   a) E5/E1 guard'lar (durum değişmişse zaten gönderme yok, ama log için kontrol et)
   b) resolve(id, 'cancelled')
   c) await mail.deleteDraft(pending.gmailDraftId) — hata olursa log + edit warning
   d) messages outbound 'draft' record'ı sil ya da status 'cancelled'
   e) edit "❌ İptal edildi <HH:MM>"
   f) answerCallback "İptal edildi"
   g) events.log('cold_draft_cancelled_via_telegram', ...)
   ```
3. `open` verb reuse (T3'te genel handler vardı).
4. Gmail adapter:
   ```ts
   async function deleteDraft(id: string): Promise<void> {
     await gmail.users.drafts.delete({ userId: "me", id });
   }
   async function getDraft(id: string): Promise<gmail_v1.Schema$Draft> {
     const { data } = await gmail.users.drafts.get({ userId: "me", id });
     return data;
   }
   ```

**Acceptance Criteria:**
- [ ] send verb happy path → mail.send çağrıldı, edit "✅ Gönderildi"
- [ ] cancel verb → mail.deleteDraft çağrıldı, edit "❌ İptal"
- [ ] E1 (durum=cevap_geldi) → mail GÖNDERİLMEDİ, edit warning
- [ ] E2 (draft yok) → mail GÖNDERİLMEDİ, edit "❌ Draft bulunamadı"
- [ ] E5 (kaybedildi/cikti) → refuse
- [ ] E6 (suppression) → refuse
- [ ] Double-tap idempotent (resolve CAS)
- [ ] open verb pending'i resolve eder, mail dokunmaz

**Dependencies:** T9
**Effort:** 3-4 saat
**Refs:** ADR-0006 §2.1 (akış #1), §2.7 (E1, E2, E5, E6, E8)

---

🔍 **Checkpoint T10:** #1 akışı uçtan-uca canlı. Cron mid_cold draft yarattığında Telegram'a 3-buton düşer; ✅ tap → mail gider; ❌ tap → draft silinir.

---

## P4 — Belirsiz Cevap Button

### T11: Inbound #5 trigger — confidence < 0.5 + draft varsa pending_action + reuse

**`cls.confidence < CONF_THRESHOLD` ve `plan.sendDraft` durumunda draft yaratıldıktan sonra pending_action + 3-buton notify. send/cancel callback'leri T10'dan reuse.**

**Files:**
- `lib/services/inbound.ts` — mevcut `if (cls.confidence < CONF_THRESHOLD)` bloğunu genişlet ve sonraya kaydır
- `lib/services/notify.ts` — `uncertainReplyApproval()` helper / message format
- `tests/services/inbound.test.ts` — düşük confidence fixture

**Implementation:**
1. `inbound.ts`'deki mevcut belirsiz cevap notify'ını (line ~148-150) **kaldır**; yerine draft create'ten SONRA aşağıdaki blok:
   ```ts
   // sendDraft && !auto durumunda (mevcut auto check'i `confidence >= CONF_THRESHOLD` zaten manual'a düşürüyor)
   if (plan.sendDraft && !auto && cls.confidence < CONF_THRESHOLD) {
     // #5: pending_action + button notify
     const { tokenPrefix } = await deps.pendingActions.createPendingAction({
       kind: "send_draft",
       leadId: lead.id,
       gmailDraftId: created.id,
       gmailThreadId: created.threadId ?? msg.threadId,
       payload: {
         action: plan.action,
         classification: cls.cls,
         confidence: cls.confidence,
         msgPreview: msg.body.slice(0, 400),
         draftPreview: draft.body.slice(0, 500),
         telegram: { chatId, messageId },  // notify dönüşünden
       },
     });
     await deps.notify.uncertainReplyApproval({ lead, msg, cls, draft, tokenPrefix });
   }
   ```
2. `uncertainReplyApproval()` mesajı ADR-0006 §1 #5 tablosundan:
   - cls + confidence
   - Müşteri mesajı (400 char)
   - AI taslağı (full body, 3500 char limit)
   - Buttons: `✅ Gönder` (`act:<prefix>:send`), `❌ İptal` (`act:<prefix>:cancel`), `✏️ Gmail` (url)
3. Mevcut `confidence < CONF_THRESHOLD` info notify (`"❓ Belirsiz cevap — elle bak"`) **kaldırılır**; bunun yerine button notify aynı moment'i karşılar. Eğer plan.sendDraft=false (örn. cls=ilgisiz, oto_yanit) ve confidence < 0.5 ise: eski `notify.hot("❓ Belirsiz cevap — elle bak", ...)` koru (draft yok → button gönderecek bir şey yok).
4. Send/cancel callback'ler T10'da yapıldı; kind='send_draft' aynı dispatcher kullanır. Sadece `cancel` semantiği #5'te "müşteri yanıt almaz" — ama mevcut handler zaten yalnız draft sil + log yapıyor, semantic farkı koddan değil event log mesajından gelir (`uncertain_reply_cancelled_via_telegram`).

**Acceptance Criteria:**
- [ ] confidence < 0.5 + plan.sendDraft → pending_action + 3-buton notify
- [ ] confidence < 0.5 + plan.sendDraft=false → eski info notify (button yok)
- [ ] confidence >= 0.5 → button trigger yok, status quo
- [ ] Send verb tap → AI taslağı gönderilir (T10 dispatcher)
- [ ] Cancel verb tap → draft silinir, müşteri yanıt almaz
- [ ] Test: low-confidence + ilgili fixture (sendDraft=true) + low-confidence + ilgisiz fixture (sendDraft=false)

**Dependencies:** T1, T2, T3, T4, T10
**Effort:** 2-3 saat
**Refs:** ADR-0006 §2.1 (akış #5), §1 (mesaj formatı)

---

🔍 **Checkpoint T11 (FINAL):** ADR-0006 §6 doğrulama checklist tamamı yeşil.

---

## Milestones

| Milestone | After Task | Achieved | Demo-able |
|---|---|---|---|
| Foundation | T4 | pending_actions + webhook + adapter; akış yok | Webhook ping (manuel curl) |
| Quick wins | T5 | Premium takip auto, failures notify | Operasyonel — Telegram'da hata görünür |
| **Demo time live** | **T8** | **#3 uçtan-uca; en yüksek kaldıraç** | **Tam E2E demo (en önemli)** |
| Cold premium live | T10 | #1 uçtan-uca; Drafts polling biter | E2E demo |
| Full scope | T11 | #5 dahil tüm akışlar | Release |

---

## Dependency Graph

```
T1 (pending_actions) ─────┐
                          ├──→ T3 (webhook) ──→ T4 (svc + cron) ──┐
T2 (telegram adapter) ────┘                                       │
                                                                  │
T5 (ACTION_MODES + failure notify) ──── (T2'ye bağlı, P0/P1 paralel) │
                                                                  ▼
T6 (AI proposedTime) ────────────────→ T7 (#3 trigger) ─→ T8 (#3 callbacks)
                                                                  │
                                                                  ▼
                                       T9 (#1 trigger) ─→ T10 (#1 callbacks)
                                                                  │
                                                                  ▼
                                                       T11 (#5 trigger, T10 reuse)
```

P0 (T1-T4) ve P1 (T5) paralel başlatılabilir. P2'nin (T6-T8) ana yolu T4 + T2'den geçer; T6 bağımsız geliştirilebilir.

---

## Doğrulama (ADR-0006 §6 mirror)

T11 sonrası tamamı yeşil olmalı:

- [ ] `lib/config/runtime.ts` `ACTION_MODES.mid_takip === "auto"` ve `ACTION_MODES.hospital_takip === "auto"`
- [ ] `lib/config/runtime.ts` `mid_cold`, `hospital_cold` "manual" (KALIR)
- [ ] `NotifyPort.notify` opts geriye uyumlu (eski çağrılar typecheck pass)
- [ ] `pending_actions` tablosu canlı + 7 gün TTL cron çalışıyor
- [ ] `/api/webhooks/telegram` secret + chat_id authz aktif
- [ ] Haiku `proposedTime` opsiyonel + substring guardrail
- [ ] `outbound.ts` mid_cold/hospital_cold draft yaratınca pending_action + Telegram notify (3 buton)
- [ ] `inbound.ts` confidence<0.5 + sendDraft durumunda pending_action + Telegram notify (3 buton)
- [ ] `inbound.ts` durum=demo_istedi + proposedTime varsa pending_action + Telegram notify (2 buton)
- [ ] Guardrail block / outbound/inbound error → Telegram failure notify (yeni)
- [ ] Solo + premium takip auto-fires Telegram'a notify atmıyor
- [ ] Premium reply (#6) notify atıyor (status quo)
- [ ] E1-E8 testleri geçer
- [ ] Telegram message edit (button kaldırılır, status satırı eklenir) tap sonrası çalışıyor
- [ ] `pnpm typecheck && pnpm test && pnpm build` temiz

---

## Ortam Değişkenleri (yeni)

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | Yes | `setWebhook` secret_token; webhook route `x-telegram-bot-api-secret-token` header'ında verify eder |
| `TELEGRAM_CHAT_ID` | Yes (zaten var) | Tek allowlist chat_id (numeric, kurucu user_id) |
| `TELEGRAM_BOT_TOKEN` | Yes (zaten var) | Mevcut |
| `CRON_SECRET` | Yes (zaten var muhtemelen) | Vercel cron auth (yoksa ekle) |

---

## Setup (T3 sonrası)

```bash
# Vercel env (preview + production)
vercel env add TELEGRAM_WEBHOOK_SECRET preview production
# Random secret üret: openssl rand -hex 32

# Telegram setWebhook (production URL ile)
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://saas-seller.vercel.app/api/webhooks/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d "allowed_updates=[\"callback_query\"]"
```

`allowed_updates=["callback_query"]` özellikle önemli — message update'lerini almıyoruz (bot'a yazı yazılırsa ignore).
