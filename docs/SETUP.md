# Faz-0 Kurulum Runbook (kurucu tarafından)

> Bu adımlar tamamlanınca `.env` dolar ve sistem canlı çalışır. Kod (Step 1-5) bunlardan bağımsız yazılabilir; ama **çalıştırmak** için bunlar şart.
> ⚠️ En riskli adım **1 (e-posta migrasyonu)** — dikkatli yap, iCloud erişimini doğrulayana kadar kapatma.

## A. Ön Koşullar
- [ ] `vethane.com` DNS yönetim erişimi (kayıt operatörü paneli)
- [ ] Workspace + Cloud sahibi olacak bir Google hesabı
- [ ] Vercel hesabı, lokal Node 20+/pnpm

---

## 1. Google Workspace Migrasyonu (info@vethane.com)
**Amaç:** info@vethane.com'u iCloud'dan Workspace'e taşı (API + push + deliverability için).

1. [ ] **Workspace'e kaydol** (Business Starter ~$7/kullanıcı/ay), `vethane.com`'u ekle.
2. [ ] **Domain doğrula** (Google'ın verdiği `TXT` kaydını DNS'e ekle).
3. [ ] Workspace Admin'de **`info@vethane.com` kullanıcısını oluştur** (MX'i değiştirmeden önce — kesinti olmasın).
4. [ ] (Opsiyonel) **Eski iCloud postalarını taşı:** Admin → Data Migration (IMAP, `imap.mail.me.com`, app-specific password ile).
5. [ ] **DNS kesişi (cutover) — sırayla:**
   - [ ] iCloud **MX** kayıtlarını sil (`mx01.mail.icloud.com`, `mx02.mail.icloud.com`).
   - [ ] Google **MX** ekle: `0 SMTP.GOOGLE.COM` (modern tek kayıt) *veya* klasik 5'li ASPMX seti.
   - [ ] **SPF** (TXT @): `v=spf1 include:_spf.google.com ~all` (iCloud include'unu kaldır).
   - [ ] **DKIM:** Admin → Apps → Gmail → "Authenticate email" → 2048-bit üret → verilen `google._domainkey` TXT'sini ekle → "Start authentication".
   - [ ] **DMARC** (TXT `_dmarc`): `v=DMARC1; p=none; rua=mailto:postmaster@vethane.com; pct=100` (önce `p=none` ile izle).
   - [ ] Apple'a ait eski DKIM (`sig1._domainkey`) ve doğrulama kayıtlarını temizle.
6. [ ] **Doğrula:** dışarıdan info@vethane.com'a mail at → Gmail'e düşüyor mu? MX/SPF/DKIM/DMARC için mxtoolbox kontrol.

> Yeni domain itibarı sıfır → cold kampanyadan önce **warmup** (tasarımda var: düşük günlük hacim).

---

## 2. Google Cloud (Gmail API + OAuth Internal + Pub/Sub)
**Amaç:** programatik Gmail erişimi + inbound push.

1. [ ] Workspace ile **aynı** Google kimliğinde **Cloud projesi** oluştur.
2. [ ] **API'leri etkinleştir:** "Gmail API" + "Cloud Pub/Sub API".
3. [ ] **OAuth consent screen → Internal** (Workspace org içi → Google doğrulaması GEREKMEZ).
   - Scope'lar: `https://www.googleapis.com/auth/gmail.modify` (oku/etiket/history) + `https://www.googleapis.com/auth/gmail.compose` (taslak oluştur + gönder).
4. [ ] **OAuth Client ID** oluştur → tip **Desktop app** (loopback redirect; setup script bunu kullanır). `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` al.
5. [ ] **Pub/Sub topic** oluştur (örn. `gmail-inbound`).
   - [ ] Topic'e **Publisher** rolü ver: `gmail-api-push@system.gserviceaccount.com` (Gmail'in publish edebilmesi için zorunlu).
   - [ ] `PUBSUB_TOPIC` = tam topic adı (`projects/<proj>/topics/gmail-inbound`).
6. [ ] **Push subscription** (⏳ ilk Vercel deploy'dan SONRA): endpoint `https://<vercel-app>/api/webhooks/gmail?token=<PUBSUB_VERIFICATION_TOKEN>`.
   - Rastgele token üret: `openssl rand -hex 16` → hem subscription URL'ine `?token=` olarak, hem `.env`'e `PUBSUB_VERIFICATION_TOKEN` olarak koy. Webhook bu token'ı doğrular (v1; OIDC yerine basit + yeterli).
   - (Lokal test için ngrok/Cloudflare Tunnel ile geçici endpoint.)

> `GMAIL_REFRESH_TOKEN` burada DEĞİL — kod yazıldıktan sonra `scripts/setup-gmail-watch.ts` çalıştırınca üretilir (OAuth client bu adımda hazır olmalı).

---

## 3. Neon Postgres
1. [ ] **Vercel Marketplace → Neon** entegrasyonu (önerilen: `DATABASE_URL`'i Vercel'e otomatik yazar) *veya* neon.tech'te proje aç.
2. [ ] `DATABASE_URL` (pooled) al. Lokal için ayrı bir **dev branch** oluştur.

---

## 4. Vercel Projesi
1. [ ] Repo'yu Vercel'e bağla.
2. [ ] **Plan:** Cron sıklığımız (saatlik + 10dk poll) için genelde **Pro** gerekir (Hobby cron sınırlı). Pro ~$20/ay.
3. [ ] Tüm env değişkenlerini Vercel'e gir (aşağıdaki tablo).

---

## 5. Telegram Bot
1. [ ] Telegram'da **@BotFather** → `/newbot` → `TELEGRAM_BOT_TOKEN` al.
2. [ ] Kendi **chat_id**'ni öğren: bota bir mesaj at, sonra `https://api.telegram.org/bot<TOKEN>/getUpdates` → `chat.id`; *veya* @userinfobot. `TELEGRAM_CHAT_ID` set et.

---

## 6. Google Places API
1. [ ] **Aynı Cloud projesinde** "Places API (New)" etkinleştir.
2. [ ] **Billing** etkin olmalı (Places ücretli; aylık ücretsiz kredi var).
3. [ ] API key oluştur, **Places API**'ye kısıtla → `GOOGLE_PLACES_API_KEY`.

---

## 7. Vercel AI Gateway
1. [ ] Vercel Dashboard → **AI Gateway** → API key oluştur → `AI_GATEWAY_API_KEY`.
2. [ ] Anthropic modellerinin (Sonnet 4.6 / Haiku 4.5) Gateway üzerinden erişilebilir olduğunu doğrula.

---

## 8. CRON_SECRET
1. [ ] Rastgele secret üret: `openssl rand -hex 32` → `CRON_SECRET` (Vercel env). Vercel Cron, bu set'liyse `Authorization: Bearer <CRON_SECRET>` gönderir; cron route'ları bunu doğrular.

---

## Sıra & Bağımlılıklar
```
1 (Workspace MX) ──► 2 (Cloud: OAuth Internal + Pub/Sub topic)
3 Neon · 5 Telegram · 6 Places · 7 AI Gateway · 8 CRON_SECRET  → bağımsız, paralel
4 Vercel deploy ──► 2.6 (Pub/Sub push subscription URL)
kod Step 6 (setup-gmail-watch) ──► GMAIL_REFRESH_TOKEN  (OAuth client 2.4 hazır olmalı)
```

## .env Hangi Adımdan Gelir
| Variable | Adım |
|---|---|
| DATABASE_URL | 3 |
| AI_GATEWAY_API_KEY | 7 |
| GOOGLE_CLIENT_ID / SECRET | 2.4 |
| GMAIL_REFRESH_TOKEN | kod Step 6 (setup script) |
| SENDER_EMAIL / NAME | 1 |
| PUBSUB_TOPIC | 2.5 |
| PUBSUB_VERIFICATION_TOKEN | 2.6 (deploy sonrası; ?token= ile eşleşir) |
| TELEGRAM_BOT_TOKEN / CHAT_ID | 5 |
| GOOGLE_PLACES_API_KEY | 6 |
| CRON_SECRET | 8 |

## Bittiğinde
- [ ] `.env` (lokal) + Vercel env tam.
- [ ] `pnpm drizzle-kit migrate` çalışır (DATABASE_URL).
- [ ] `pnpm tsx scripts/setup-gmail-watch.ts` → refresh_token + watch.
- [ ] İlk deploy → Pub/Sub push subscription URL'ini bağla.
- → Artık outbound/inbound döngüleri canlı.
