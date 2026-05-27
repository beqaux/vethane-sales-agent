# ADR-0006 — Telegram, dar inline-button onay yüzeyi olarak çift-yönlü hale getirildi

> **Durum:** Accepted (2026-05-27)
> **Bağlam:** Grilling oturumu çıktısı (`grill-with-docs`, 2026-05-27).
> **Karar veren:** Berkay Kıran (kurucu).
> **İlgili:** [ADR-0005 — Demo, sistem gösterimi](0005-demo-sistem-gosterimi-iki-adimli-satis.md), [`CONTEXT.md` karar #6 — Gmail-yerel yüzey](../../CONTEXT.md), [`CONTEXT.md` karar #7 — Telegram bildirim](../../CONTEXT.md).

---

## 1. Bağlam

Telegram bot bugüne kadar **tek-yön bildirim** olarak konumlandırıldı (`NotifyPort.notify(text)`). Yapısal nedeni: CONTEXT karar #6 yüzeyi Gmail-yerel olarak sabitledi (taslak=onay, etiket=pipeline); Telegram sadece "hot signal" momentlerinde ping atıyordu.

Sonraki iterasyonlarda `ACTION_MODES` haritası birçok aksiyonu auto'ya çekti (`solo_*`, `mid_reply`, `hospital_reply`, `demo_reply`, `cikis_reply`). Manuel kalan dar küme: `mid_cold`, `mid_takip`, `hospital_cold`, `hospital_takip`, `demo_followup`. Bunlar tarihsel olarak Gmail Drafts kuyruğunda biriken + kurucunun Gmail'i siklik açtığı durumdu.

Son commit'lerden (`fix/silence-after-demo-confirm`, `fix/strip-quoted-reply`, `fix/sonnet-and-prompt-hardening`) `demo_followup` akışında bot susuyor (durum=`demo_istedi`); müşteri demo onayı sonrası "Salı 14:00 müsait" yazınca kurucu Gmail'i açıp manuel cevap yazmak zorunda kaldı. Bu, kazanılmış müşteri için yüksek sürtünme momenti.

Kurucu istek: "Telegram'dan ✅/❌ ile mailin gönderilmesini onaylayabilir miyim? Veya müşteri belli bir gün/saat söylediğinde onaylamak için?"

Soru: Telegram **ana yüzey mi olsun (Gmail'i replace)**, yoksa **dar onay shortcut'u mu olsun (Gmail'i augment)**?

## 2. Karar

**Telegram, Gmail-yerel kararının üstüne dar bir inline-button onay yüzeyi olarak eklenir.** CONTEXT karar #6 (Gmail-yerel) korunur; Telegram tamamlayıcı kısa-yol.

### 2.1 Onay yüzeyleri (3 yer)

| Akış | Durum | Buton seti |
|---|---|---|
| **#1 cold premium taslak** | `mid_cold` / `hospital_cold` taslak cron tarafından yaratıldığında | ✅ Gönder · ❌ İptal · ✏️ Gmail |
| **#3 demo zaman onayı** | Lead `durum=demo_istedi`; inbound mesajda AI literal saat alıntısı çıkardı | ✅ Onayla · ✏️ Gmail |
| **#5 belirsiz cevap taslağı** | Inbound classify `confidence < 0.5`; AI tahmini taslak Gmail Drafts'a düştü | ✅ Gönder · ❌ İptal · ✏️ Gmail |

**İptal semantiği (tek kavram):** "Botun ürettiği taslağı sil, lead'in mevcut akışına dokunma." #1'de mail gitmez + sekans bugünkü gibi akmaya devam; #5'te mail gitmez + müşteriye sessizlik (kasıtlı).

**Erteleme butonu yok.** Marjinal değer + 5 ek karar (UI keyboard, seq rollback, TTL, re-pick logic). "Şimdi değil, sonra" → Gmail'den draft sil; cron sıradaki step'i zaten planladığı için lead kaçmaz.

### 2.2 ACTION_MODES değişimi

| Action | Önce | Sonra |
|---|---|---|
| `mid_takip` | manual | **auto** |
| `hospital_takip` | manual | **auto** |
| `mid_cold` | manual | manual (+ Telegram button) |
| `hospital_cold` | manual | manual (+ Telegram button) |
| Diğerleri | — | değişmedi |

Gerekçe: Premium **ilk temas** asimetrik (250 hayal hesabından biri yanarsa kalıcı; AI tonu hala kalibre ediliyor) → manuel kalır. **Takip** ise zaten kalıp tutturulmuş, daha düşük varyans → CONTEXT karar #4'ün gradyan-auto politikasının doğal sıradaki adımı.

### 2.3 Bildirim politikası (8-A)

| Kanal | Davranış |
|---|---|
| Solo outbound auto-fires | Sessiz (status quo — hacim yüksek) |
| Premium outbound auto-fires (`mid_takip`, `hospital_takip`) | Sessiz (kalıp dahilinde, ping marjinal) |
| Premium reply auto-fires (`mid_reply`, `hospital_reply`) | Notify (status quo — müşteri etkileşimi) |
| **Guardrail block** | **Notify** (yeni — debugging hız) |
| **Error** (Gmail/AI/DB exception) | **Notify** (yeni — sessiz hata yok) |
| Button-tap sonucu | Mevcut Telegram mesajını **edit**: butonlar kaybolur, status satırı eklenir |

### 2.4 #3 saat onayı — parsing yok, literal echo

AI'nın işi tarih ANLAMAK değil ALINTILAMAK:

- Haiku classify çıktısına opsiyonel `proposedTime: { raw: string }` field'ı eklenir.
- AI gelen mesajda spesifik gün+saat önerisi gördüğünde, müşterinin **literal substring**'ini çıkarır.
- Kod-seviyesi guardrail: `proposedTime.raw` `msg.body`'de literal substring değilse → drop (uydurma engeli).
- ISO timestamp yok, timezone yok, relative date resolution yok.
- Confirmation maili template: müşterinin orijinal ifadesini olduğu gibi echo eder.

Confirmation maili template:

```
Merhaba [varsa: ad],

"[proposedTime.raw]" bende de uygun.
Görüşme linkini toplantıdan ~15 dk önce ileteceğim.

İyi çalışmalar,
[BRAND.senderName]
```

"Ad" çıkarımı: `lead.kararVerici` → yoksa from/imza ayrıştırma → yoksa "Merhaba,".

**Sabit Meet link YOK.** Erişim/expiry riski + tek link kırılırsa tüm demolar bozulur. "15 dk önce link iletirim" promise + kurucu manuel iletir = daha güvenli ve fresh.

### 2.5 State model

Yeni tablo `pending_actions`:

```
id              uuid primary
kind            'send_draft' | 'cancel_draft' | 'confirm_demo_time'
lead_id         fk(leads.id)
gmail_draft_id  text nullable   -- #1, #5 için
gmail_thread_id text nullable   -- #3 için
payload_json    jsonb           -- #3'te raw quote vs.
status          'pending' | 'resolved' | 'expired' | 'cancelled'
expires_at      timestamptz (created_at + 7 gün)
created_at      timestamptz
resolved_at     timestamptz nullable
```

- callback_data formatı: `act:<8-char prefix>:<verb>` (64-byte sınırına bol marj).
- 7 gün TTL; expired tap → "⏱ Bu onay 7 günden eski."
- Idempotency: `status=resolved` → 2. tap "Zaten yapıldı (<timestamp>)" toast.

### 2.6 Mimari değişimler

- `NotifyPort` arayüzü: `notify(text, opts?: { buttons?: Button[][], inlineKeyboard?: ... })` (geriye uyumlu — opts opsiyonel).
- Yeni route: `app/api/webhooks/telegram/route.ts` — secret header verification, `from.id` allowlist (TELEGRAM_CHAT_ID).
- Yeni servis: `lib/services/pending-action.ts` — yarat/çöz/expire.
- Yeni adapter: `lib/adapters/telegram.ts` genişler — `editMessageText`, `editMessageReplyMarkup`, `answerCallbackQuery`.
- AI classify schema: `proposedTime` opsiyonel alanı (validate ediliyor: substring guardrail).

### 2.7 Edge case'ler

| # | Senaryo | Davranış |
|---|---|---|
| E1 | Sen #1'i tap'lemeden müşteri arada cevap vermiş (durum=`cevap_geldi`) | Auto-cancel. Mesaj edit: "⚠️ Müşteri arada cevap verdi — taslak iptal." |
| E2 | Draft Gmail'de manuel silinmiş | Mesaj edit: "❌ Draft bulunamadı." |
| E3 | İki kez tap | Idempotent (status=resolved → toast). |
| E4 | 7+ gün sonra tap | "⏱ Bu onay 7 günden eski." |
| E5 | Lead durum manuel "kaybedildi"/"cikti" | Refuse + edit: "ℹ️ Lead durumu değişmiş, gönderilmedi." |
| E6 | Suppression meanwhile | Refuse + edit: "ℹ️ Email suppression'da." |
| E7 | Farklı chat_id'den tap (yetkisiz) | Sessizce yok say + event log. |
| E8 | Gmail send başarısız | Retry (3x), sonra edit "❌ Gönderim başarısız." |

## 3. Gerekçe

**B (augment) > A (replace).** Gmail'in audit + edit + filter + thread görünümü kaybedilmemeli. Telegram'da metin editörü kurmak = "düzelt" senaryosunu yarı-yol halletmek; ROI vermez. Kısa-onay (yes/no) momentleri ise Telegram'ın güçlü tarafı (mobil notif + tek tap).

**Parsing yerine literal echo.** "Salı 14:00", "yarın 10", "önümüzdeki Çarşamba öğleden sonra" — Türkçe + relative tarih + locale ambiguity = parsing yüzeyi geniş. AI literal alıntı + template echo = halüsinasyon 0; ambiguity'i müşteri'ye geri vererek paylaşıyoruz (sen "yarın 10 bende uygun" deyince müşteri kendi gönderdiği "yarın"ı kabul edilmiş sayar; aralarındaki gün tanımı ortaktır).

**Sabit Meet link reddedildi.** Kurucu önerisi: "Link bozulabilir, açılmayabilir." Doğru — tek statik link tüm demolar için single point of failure. "15 dk önce link iletirim" promise = link her seferinde fresh + kurucu kontrolünde.

**Premium cold manuel kalmaya devam.** Asimetrik risk: 250 premium hesabın biri yakılırsa kalıcı (aynı kuruma ikinci şans yok). AI tonu son haftalarda hardening commit'leriyle yeni stabilize edildi; "düzeltmesiz 10 mid_cold" eşiği henüz dolmadı (CONTEXT §6).

**Snooze reddedildi.** Marjinal kazanım vs. (a) çoklu süre keyboard + (b) seq rollback + (c) draft cleanup + (d) TTL + (e) re-pick logic = 5 ek karar. Gmail'de draft silmek + cron'un sıradaki step'i yarın üretmesi yeterli.

**pending_actions tablosu, callback_data inline encode'a tercih.** TTL + idempotency + audit + multi-button reference + payload genişliği — hepsi tablo ile temiz; callback_data'da 64-byte sınırı altında bunları sıkıştırmak kırılgan.

## 4. Sonuçlar

### Pozitif
- `demo_followup` akışında tek-tap saat onayı → kurucu Gmail'i açmaz.
- Premium cold draft onayı Gmail Drafts polling'ten Telegram push'a döner.
- Failure notify → guardrail block'lar artık görünür; sessiz hata yok.
- `mid_takip` / `hospital_takip` auto → ikinci-üçüncü cold touch'lar hızlanır.

### Negatif
- Yeni callback altyapısı: webhook + grammy callback handling + `pending_actions` tablosu + idempotency + TTL job. Büyük yüzey artışı.
- AI classify schema değişimi (`proposedTime`) — prompt güncelleme; ek field optional olduğu için backward compat ok.
- Premium takip auto'ya geçti → tonal kayma için failsafe yok (içeriksel guardrail var: fiyat yasağı, opt-out). Tonal hata olursa lead bazında olur, sistem-genel değil; ama ölçeklenebilir hata kaynağı.
- 3 farklı button flow = 3 tip pending_action + 3 message format + 3 edge case set. Test yüzeyi büyük.

### Nötr (operasyonel revizyonlar)
- `CONTEXT.md` karar #6 (yüzey notu) + #7 (bildirim → çift-yön) güncellendi.
- `CONTEXT.md` §6 "Açık Kalan Küçük Kararlar" tablosunda "Demo randevusu" satırı + "Auto'ya geçiş" satırı güncellendi.
- `lib/config/runtime.ts` ACTION_MODES tablosu 2 satır değişir.
- ADR-0005'teki `demo_izledi` yeni state ihtiyacı bu kararla daha belirgin; ama bu iterasyonda hala deferred (durum=`demo_istedi` korunur).

## 5. Alternatifler (değerlendirildi, reddedildi)

### Alt-1: Plan A — Telegram ana yüzey, Gmail transport
Reddedildi. "Düzelt" senaryosu Telegram'da metin editörü kurmayı veya Gmail'e döndürmeyi gerektirir → yarı-yol yüzey. Gmail'in audit/forward/filtre gücü kayıp.

### Alt-2: Tam auto — #1 ve #2 de auto, hiç manuel yok
Reddedildi (orta-grilling pivot). Cold ilk temas asimetrik (premium hesap yakma); takip auto (bu kararda gerçekleşti) gradyan-auto'nun yeterli kademesi.

### Alt-3: ISO time parsing + Google Calendar event auto-create
Reddedildi. Halüsinasyon riski (TR + relative tarih); Calendar API entegrasyonu kapsam büyütür. Literal echo template yeterli; demo volume artarsa v2 ele alınır.

### Alt-4: Snooze butonu (çoklu süre keyboard)
Reddedildi. Marjinal kazanım vs. UI/state karmaşası.

### Alt-5: Sabit Meet link
Reddedildi. Erişim/expiry riski. "15 dk önce link iletirim" daha güvenli.

### Alt-6: #6 (premium guess auto-reply) manuel'e düşür + button
Reddedildi (orta-grilling pivot). Hız kaybı; mevcut auto'da guardrail (no-price) zaten tutuyor.

### Alt-7: callback_data'ya in-line encode (pending_actions tablosu yok)
Reddedildi. TTL + idempotency + audit + multi-button + payload — 64-byte sınırının altında temiz değil.

## 6. Doğrulama

Karar şu davranışsal kontrollerle doğrulanır:

- [ ] `lib/config/runtime.ts` `ACTION_MODES.mid_takip === "auto"` ve `ACTION_MODES.hospital_takip === "auto"`.
- [ ] `lib/config/runtime.ts` `ACTION_MODES.mid_cold === "manual"` ve `ACTION_MODES.hospital_cold === "manual"` (kalır).
- [ ] `lib/domain/ports.ts` `NotifyPort.notify` opsiyonel `buttons` opts kabul ediyor (mevcut çağrılar geriye uyumlu).
- [ ] `lib/db/schema.ts` `pending_actions` tablosu + migration var.
- [ ] `app/api/webhooks/telegram/route.ts` route var; secret header + chat_id allowlist verify ediyor.
- [ ] Haiku classify response schema'da `proposedTime: { raw: string }` opsiyonel field var; prompt günün tarihi vs. değil "literal substring çıkar" diyor.
- [ ] Guardrail: `proposedTime.raw` `msg.body`'de substring değilse drop ediyor.
- [ ] Outbound cron `mid_cold`/`hospital_cold` taslak yarattığında pending_action + Telegram notify (3 buton) gönderiyor.
- [ ] Inbound `confidence < 0.5` durumunda pending_action + Telegram notify (3 buton) gönderiyor.
- [ ] Inbound `durum=demo_istedi` + `proposedTime` varlığında pending_action + Telegram notify (2 buton) gönderiyor.
- [ ] Guardrail block / outbound error → Telegram notify (failure) gönderiyor.
- [ ] Solo outbound auto-fires Telegram'a notify atmıyor.
- [ ] Premium outbound auto-fires (`mid_takip`/`hospital_takip`) Telegram'a notify atmıyor.
- [ ] Premium reply auto-fires (#6) Telegram'a notify atıyor (status quo).
- [ ] Edge case'ler E1-E8 testlerde geçiyor.
- [ ] Telegram message edit (button kaybolur, status satırı) tap sonrası çalışıyor.
- [ ] 7 gün+ pending_action otomatik expire oluyor (cron veya tap-time check).

## 7. Etki Alanı

**Değişir:**
- `lib/config/runtime.ts` (2 ACTION_MODES satırı)
- `lib/domain/ports.ts` (NotifyPort opts genişler)
- `lib/db/schema.ts` (pending_actions tablosu)
- `lib/adapters/telegram.ts` (button + edit + answerCallbackQuery)
- `lib/services/notify.ts` (button format helpers, mesaj template'ları 3 tip + failure)
- `lib/services/inbound.ts` (#3 + #5 button trigger, proposedTime extraction)
- `lib/services/outbound.ts` (#1 button trigger)
- `lib/ai/...` (classify prompt + schema: proposedTime alanı)
- Yeni: `app/api/webhooks/telegram/route.ts`
- Yeni: `lib/services/pending-action.ts`
- Yeni: `lib/services/telegram-callback.ts` (callback verb routing)
- Drizzle migration

**Değişmez:**
- Gmail-yerel ana yüzey (CONTEXT karar #6).
- Guardrail kuralları (fiyat yasağı, opt-out, suppression).
- Lead/segment data modeli.
- Solo cold/takip auto davranışı.
- Outbound sequence/cron mantığı.
- Calendar entegrasyonu (deferred).
- `demo_izledi` yeni state önerisi (ADR-0005'te belirtildi, hala deferred).

## 8. Uygulama Sırası (öneri)

| Pri | Paket | Bağımsız? | Etki |
|---|---|---|---|
| **P0** | `pending_actions` tablo + migration + repo + webhook route iskeleti + chat_id authz | Evet | Altyapı; başka şey çalışmaz |
| **P1** | ACTION_MODES flip (`mid/hospital_takip → auto`) + failure notify | P0'dan bağımsız | Küçük config + büyük günlük etki |
| **P2** | #3 demo zaman onayı (AI proposedTime + button + literal echo template) | P0 lazım | En yüksek kaldıraç; bugünkü tam-manuel akış tek-tap'e iner |
| **P3** | #1 cold premium taslak button (mid_cold/hospital_cold) | P0 lazım | Günlük Gmail Drafts polling biter |
| **P4** | #5 belirsiz cevap button | P0 lazım | Edge case; nadir trigger |

P1 küçük olduğu için P0 ile bundle edilebilir. P2 ilk hedef.

## 9. Referanslar

- [`CONTEXT.md` karar #6, #7](../../CONTEXT.md) — Yüzey + bildirim (bu ADR ile güncellendi).
- [`CONTEXT.md` karar #4](../../CONTEXT.md) — Onaylı başla, kademeli auto'ya al (bu ADR takip auto'yu örnekliyor).
- [ADR-0005](0005-demo-sistem-gosterimi-iki-adimli-satis.md) — Demo = sistem gösterimi; bu ADR demo onayı sonrası akışı buton ile çözüyor.
- `lib/adapters/telegram.ts:1-35` — Mevcut tek-yön adapter (genişletilecek).
- `lib/services/notify.ts:18-41` — Mevcut mesaj formatı (button + 3 template ile genişletilecek).
- `lib/services/inbound.ts:147-178` — Mevcut notify trigger noktaları (#3 + #5 trigger eklenecek).
- `lib/config/runtime.ts:15-32` — ACTION_MODES (mid_takip, hospital_takip auto'ya alınacak).
- Grilling oturumu: `/grill-with-docs` çıktısı (2026-05-27).
